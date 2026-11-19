package com.example.raisechat;

import java.nio.file.Path;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

// テスト用の PostgreSQL を Docker で起動し、接続先を自動で差し替える（開発用の DB は使わない）。
// Repository のテスト（@DataJpaTest）はこれだけを使い、S3（MinIO）は起動しない
@TestConfiguration(proxyBeanMethods = false)
public class DatabaseTestConfiguration {

	// 開発用と同じ、pg_bigm を足した postgres:17（db/Dockerfile。compose.yaml と同じ）。
	// テストは backend のフォルダで動く。Docker のキャッシュがあれば、作り直しは数秒で終わる
	private static final ImageFromDockerfile IMAGE = new ImageFromDockerfile("raisechat-db:17", false)
		.withFileFromPath(".", Path.of("..", "db"));

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgresContainer() {
		return new PostgreSQLContainer(DockerImageName.parse(IMAGE.get()).asCompatibleSubstituteFor("postgres"));
	}

}
