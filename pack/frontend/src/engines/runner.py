"""Запуск проекта внутри Pyodide. Определяет функцию execool_run(entry, files_json)."""

import importlib
import json
import os
import pathlib
import runpy
import shutil
import sys
import traceback

PROJECT_DIR = "/project"

# Модули, которые были загружены до первого запуска (стандартная библиотека и т. п.).
_BASELINE_MODULES = set(sys.modules)


def _is_project_path(path, project_dir):
    return bool(path) and os.path.abspath(path).startswith(project_dir + os.sep)


def _write_project(project_dir, files):
    root = pathlib.Path(project_dir)
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    resolved_root = root.resolve()

    for item in files:
        target = (root / item["path"]).resolve()
        if resolved_root not in target.parents:
            raise ValueError("Недопустимый путь файла: " + item["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(item["content"], encoding="utf-8")


def _forget_project_modules(project_dir):
    """Забываем модули прошлого запуска, чтобы правки в файлах подхватывались."""
    for name in list(sys.modules):
        if name in _BASELINE_MODULES:
            continue
        module = sys.modules.get(name)
        paths = [getattr(module, "__file__", None)]
        paths += list(getattr(module, "__path__", None) or [])
        if any(_is_project_path(p, project_dir) for p in paths):
            del sys.modules[name]


def _exit_code(code):
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    print(code, file=sys.stderr)
    return 1


def _format_error(exc, project_dir):
    # Пропускаем кадры самого раннера и runpy, показываем только код проекта.
    tb = exc.__traceback__
    while tb is not None and not _is_project_path(tb.tb_frame.f_code.co_filename, project_dir):
        tb = tb.tb_next
    text = "".join(traceback.format_exception(type(exc), exc, tb))
    return text.replace(project_dir + os.sep, "")


def execool_run(entry, files_json, project_dir=PROJECT_DIR):
    """Записывает файлы проекта, запускает entry как __main__, возвращает код выхода."""
    files = json.loads(files_json)
    exit_code = 0
    old_cwd = os.getcwd()

    try:
        _write_project(project_dir, files)
        _forget_project_modules(project_dir)
        importlib.invalidate_caches()
        sys.path.insert(0, project_dir)
        os.chdir(project_dir)
        runpy.run_path(os.path.join(project_dir, entry), run_name="__main__")
    except SystemExit as exc:
        exit_code = _exit_code(exc.code)
    except BaseException as exc:
        exit_code = 1
        sys.stderr.write(_format_error(exc, project_dir))
    finally:
        try:
            os.chdir(old_cwd)
        except OSError:
            pass
        while project_dir in sys.path:
            sys.path.remove(project_dir)
        sys.stdout.flush()
        sys.stderr.flush()

    return exit_code
