package com.example.execool;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

/**
 * Собранный фронтенд лежит в classpath:/static и раздаётся самим Spring.
 * Файлы Vite в /assets получают хэш в имени и после сборки не меняются,
 * поэтому их можно кэшировать на год. Всё остальное (index.html, Pyodide)
 * проверяется при каждой загрузке: см. spring.web.resources.cache в application.yaml.
 */
@Configuration
public class StaticResourcesConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/assets/**")
                .addResourceLocations("classpath:/static/assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic());
    }
}