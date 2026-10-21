import {
  startSession,
  saveFile,
  deleteFile,
  runCode,
  stopSession,
} from "./api.js";

export async function createProjectSession(projectId, userId) {
  const result = await startSession(projectId, userId);

  if (!result?.session_id) {
    throw new Error("Backend did not return session_id");
  }

  return result;
}

export async function persistFile(sessionId, filePath, content) {
  if (!sessionId) {
    throw new Error("Сначала открой проект");
  }

  return saveFile(sessionId, filePath, content);
}

export async function removeFile(sessionId, filePath) {
  if (!sessionId) return;
  return deleteFile(sessionId, filePath);
}

export async function executeProject(sessionId, command) {
  if (!sessionId) {
    throw new Error("Сначала открой проект");
  }

  return runCode(sessionId, command);
}

export async function terminateSession(sessionId) {
  if (!sessionId) return;
  return stopSession(sessionId);
}