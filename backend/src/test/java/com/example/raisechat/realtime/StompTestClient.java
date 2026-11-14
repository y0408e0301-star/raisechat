package com.example.raisechat.realtime;

import java.lang.reflect.Type;
import java.net.URI;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpHeaders;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.MessageHeaders;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.WebSocketClient;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.util.UriComponentsBuilder;

import jakarta.servlet.http.Cookie;

// テストの中で、本物の WebSocket で /ws につなぐ STOMP のクライアント（技術スタック定義書 WebSocketStompClient）。
// 届いた通知の本文（JSON の文字列）・ERROR のフレーム・切れたときの理由を、あとで調べられるように取っておく
final class StompTestClient implements AutoCloseable {

	private static final long TIMEOUT_SECONDS = 5;

	private final StompSession session;

	private final BlockingQueue<String> received;

	private final BlockingQueue<String> errors;

	private final CompletableFuture<CloseStatus> closed;

	private StompTestClient(StompSession session, BlockingQueue<String> received, BlockingQueue<String> errors,
			CompletableFuture<CloseStatus> closed) {
		this.session = session;
		this.received = received;
		this.errors = errors;
		this.closed = closed;
	}

	// access の Cookie でつなぐ。origin があれば Origin ヘッダーを付ける（ブラウザと同じ）
	static StompTestClient connect(int port, @Nullable Cookie access, @Nullable String origin)
			throws InterruptedException, ExecutionException, TimeoutException {
		BlockingQueue<String> received = new LinkedBlockingQueue<>();
		BlockingQueue<String> errors = new LinkedBlockingQueue<>();
		CompletableFuture<CloseStatus> closed = new CompletableFuture<>();
		WebSocketStompClient client = new WebSocketStompClient(new ClosingRecorder(closed));
		client.setMessageConverter(new JsonAsString());
		WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
		if (access != null) {
			headers.add(HttpHeaders.COOKIE, access.getName() + "=" + access.getValue());
		}
		if (origin != null) {
			headers.setOrigin(origin);
		}
		StompSession session = client.connectAsync("ws://localhost:" + port + "/ws", headers, new StompHeaders(),
				new StompSessionHandlerAdapter() {

					@Override
					public Type getPayloadType(StompHeaders headers) {
						return String.class;
					}

					// ERROR のフレーム。本文がなければ message ヘッダーを取っておく
					@Override
					public void handleFrame(StompHeaders headers, @Nullable Object payload) {
						errors
							.add((payload != null) ? payload.toString() : String.valueOf(headers.getFirst("message")));
					}

				})
			.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
		return new StompTestClient(session, received, errors, closed);
	}

	// 購読する。届いた本文は next() で読む。購読の権限はサーバーで確かめるので、断られたかは error() で見る
	StompSession.Subscription subscribe(String destination) {
		return this.session.subscribe(destination, new StompFrameHandler() {

			@Override
			public Type getPayloadType(StompHeaders headers) {
				return String.class;
			}

			@Override
			public void handleFrame(StompHeaders headers, @Nullable Object payload) {
				StompTestClient.this.received.add(String.valueOf(payload));
			}

		});
	}

	// 画面からは送らない SEND を送ってみる
	void send(String destination, String body) {
		this.session.send(destination, body);
	}

	// 届いた本文。5 秒待っても来なければ null
	@Nullable String next() throws InterruptedException {
		return this.received.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
	}

	// 少し待っても何も届かないか
	boolean nothingWithin(long millis) throws InterruptedException {
		return this.received.poll(millis, TimeUnit.MILLISECONDS) == null;
	}

	// 断られたか（購読・SEND）。サーバーは ERROR のフレームを送ってから接続を切るが、CI のように遅い環境では
	// 切れるのが先に届いて ERROR のフレームを受け取れないことがあるので、どちらかが 5 秒以内に起きれば断られたとみなす
	boolean rejected() throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
		while (System.nanoTime() < deadline) {
			if (!this.errors.isEmpty() || this.closed.isDone()) {
				return true;
			}
			Thread.sleep(20);
		}
		return false;
	}

	// 切れたときの理由（サーバーが付けた番号）
	CloseStatus closeStatus() throws InterruptedException, ExecutionException, TimeoutException {
		return this.closed.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
	}

	boolean isConnected() {
		return this.session.isConnected();
	}

	// サーバーが先に切っていることがある（ERROR・JWT の期限）ので、切れなくても失敗にしない
	@Override
	public void close() {
		try {
			this.session.disconnect();
		}
		catch (MessageDeliveryException | IllegalStateException ex) {
			// もう切れている
		}
	}

	// 通知の本文（application/json）を、読まずに文字列のまま受け取る。StringMessageConverter は text/plain
	// しか受けないため
	private static final class JsonAsString extends StringMessageConverter {

		@Override
		protected boolean supportsMimeType(MessageHeaders headers) {
			return true;
		}

	}

	// 切れたときの CloseStatus を取っておく WebSocket のクライアント（STOMP のクライアントからは見えないため）
	private static final class ClosingRecorder implements WebSocketClient {

		private final StandardWebSocketClient delegate = new StandardWebSocketClient();

		private final CompletableFuture<CloseStatus> closed;

		ClosingRecorder(CompletableFuture<CloseStatus> closed) {
			this.closed = closed;
		}

		@Override
		public CompletableFuture<WebSocketSession> execute(WebSocketHandler handler, String uriTemplate,
				@Nullable Object... uriVariables) {
			URI uri = UriComponentsBuilder.fromUriString(uriTemplate).buildAndExpand(uriVariables).encode().toUri();
			return execute(handler, null, uri);
		}

		@Override
		public CompletableFuture<WebSocketSession> execute(WebSocketHandler handler,
				@Nullable WebSocketHttpHeaders headers, URI uri) {
			return this.delegate.execute(new WebSocketHandlerDecorator(handler) {

				@Override
				public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
					StompTestClient.ClosingRecorder.this.closed.complete(status);
					super.afterConnectionClosed(session, status);
				}

			}, headers, uri);
		}

	}

}
