# Execool - Control Plane (Java Spring Boot PoC)

This is the backend Control Plane for **Execool**, a decoupled, cloud-based IDE architecture. It manages session lifecycles, virtual file systems (VFS) in temporary storage, and provides a clean REST API for the frontend.

## Architecture Highlights
* **Isolated Workspaces:** Session files are stored securely in the system's temporary directory (`java.io.tmpdir/execool-sessions`).
* **Virtual File System (VFS):** Built-in structural protection against `Path Traversal` attacks.
* **Stateless API Ready:** Designed to seamlessly integrate with a future Go-based execution agent.

---

## Prerequisites
* **Java Development Kit (JDK):** Version 17 or higher.
* **Maven:** Version 3.6+ (or use the included `./mvnw` wrapper if available).

---

## Project Structure
All source files are located under `src/main/java/com/example/execool/`:
* `ExecoolApplication.java` — Spring Boot entry point.
* `WebConfig.java` — CORS configuration for frontend integration.
* `SessionWorkspaceService.java` — VFS logic and temporary file workspace management.
* `SessionController.java` — REST API endpoints (`/start`, `/files`, `/file`, `/run`, `/delete`).

---

## How to Build and Run

1. **Clone or open the project directory** in your terminal where `pom.xml` is located.

2. **Build the application** using Maven:
   ```bash
   mvn clean package
   ```

3. **Run the Spring Boot application**:
   ```bash
   mvn spring-boot:run
   ```
   Alternatively, you can run the compiled jar:
   ```bash
   java -jar target/execool-0.0.1-SNAPSHOT.jar
   ```

4. The server will start on **`http://localhost:8080`**.

---

## API Quick Reference

* **Start Session:**
  `POST /api/sessions/start`
  ```json
  {
    "project_id": "proj-999",
    "user_id": "user-123"
  }
  ```

* **Get Project Files List:**
  `GET /api/sessions/{session_id}/files`

* **Get File Content:**
  `GET /api/sessions/{session_id}/file?path=main.py`

* **Save/Update File:**
  `PUT /api/sessions/{session_id}/files`
  ```json
  {
    "file_path": "main.py",
    "content": "print('Hello, Execool!')\n"
  }
  ```

* **Run Code (Dummy):**
  `POST /api/sessions/{session_id}/run`
  ```json
  {
    "command": "python3 main.py"
  }
  ```

* **Terminate Session & Clean Workspace:**
  `DELETE /api/sessions/{session_id}`