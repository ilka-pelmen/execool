import { newProjectId } from "../services/storage.js";

// Типы проектов. Новый язык добавляется записью сюда и своим движком выполнения.
export const PROJECT_TYPES = [
  {
    id: "python",
    name: "Python",
    description: "Выполняется прямо в браузере, без сервера",
    runtime: "wasm",
    entry: "main.py",
    template: [
      {
        path: "main.py",
        content: 'name = input("Как тебя зовут? ")\nprint(f"Привет, {name}!")\n',
      },
    ],
  },
];

export function getProjectType(id) {
  return PROJECT_TYPES.find((type) => type.id === id) ?? null;
}

/** files: свои файлы вместо шаблона (например, при импорте). */
export function createProject(typeId, name = "myapp", files = null) {
  const type = getProjectType(typeId);
  if (!type) throw new Error(`Неизвестный тип проекта: ${typeId}`);

  return {
    id: newProjectId(),
    type: type.id,
    name,
    files: (files ?? type.template).map((file) => ({ ...file })),
  };
}
