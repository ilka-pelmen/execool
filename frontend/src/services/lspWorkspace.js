// Переход к определению в другой файл.
//
// lsp-client просит рабочее пространство показать файл (workspace.displayFile).
// Стандартная реализация умеет только уже открытые файлы, поэтому для файлов проекта
// мы переключаем файл в приложении и ждём, пока редактор для него появится.
// Файлы вне проекта (заглушки стандартной библиотеки на агенте) открыть нельзя:
// сообщаем об этом и никуда не переходим.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Путь файла в проекте по адресу из ответа сервера; null, если файл вне проекта. */
export function projectPathFromUri(uri, rootUri) {
  if (!rootUri || !uri.startsWith(`${rootUri}/`)) return null;

  try {
    return decodeURIComponent(uri.slice(rootUri.length + 1)) || null;
  } catch {
    return null;
  }
}

/**
 * Класс рабочего пространства на основе DefaultWorkspace из lsp-client.
 * hooks: { getRootUri(), openFile(path), onUnavailable(uri) }
 */
export function createWorkspaceClass(
  DefaultWorkspace,
  hooks,
  { waitMs = 1000, stepMs = 20 } = {}
) {
  return class AppWorkspace extends DefaultWorkspace {
    async displayFile(uri) {
      const openView = () =>
        this.files.find((file) => file.uri === uri)?.getView() ?? null;

      const current = openView();
      if (current) return current;

      const path = projectPathFromUri(uri, hooks.getRootUri());
      if (path === null) {
        hooks.onUnavailable?.(uri);
        return null;
      }

      await hooks.openFile?.(path);

      for (let waited = 0; waited < waitMs; waited += stepMs) {
        const view = openView();
        if (view) return view;
        await sleep(stepMs);
      }
      return null;
    }
  };
}
