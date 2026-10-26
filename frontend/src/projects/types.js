// Типы проектов. Новый язык добавляется записью сюда и своим движком выполнения.
export const PROJECT_TYPES = [
  {
    id: "python",
    name: "Python",
    description: "Выполняется прямо в браузере, без сервера",
    runtime: "wasm",
    entry: "main.py",
    template: [],
  },
];

export function getProjectType(id) {
  return PROJECT_TYPES.find((type) => type.id === id) ?? null;
}

export function createProject(typeId, name = "myapp") {
  const type = getProjectType(typeId);
  if (!type) throw new Error(`Неизвестный тип проекта: ${typeId}`);

  return {
    type: type.id,
    name,
    files: type.template.map((file) => ({ ...file })),
  };
}
