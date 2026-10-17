package com.example.execool;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestTemplate;

@SpringBootApplication
@EnableScheduling
public class ExecoolApplication {
    public static void main(String[] args) {
        SpringApplication.run(ExecoolApplication.class, args);
    }
}