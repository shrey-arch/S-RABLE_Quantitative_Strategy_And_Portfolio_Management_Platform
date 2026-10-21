"""Layer 1 of the strategy sandbox: a static check of the code (Feature 6).

Reads the code's syntax tree (nothing is run or imported) and refuses anything a
trading strategy has no need for: imports other than math, statistics, numpy and
pandas; the built-ins that reach outside the code (open, eval, getattr...); any
double-underscore name or private attribute (the usual ways out of a sandbox);
the numpy/pandas functions that read or write files, run expressions, use
randomness or the clock.

It is stdlib-only on purpose: the sandbox's child process runs it again before
running the code, without importing anything from the app.

Layer 2 (child.py) assumes this check can be bypassed and still blocks files,
network, processes and imports at run time; layer 3 is the process or container
with its limits (runner.py).
"""

from __future__ import annotations

import ast
from dataclasses import dataclass

ENTRY_POINT = "generate_signal"
MAX_CODE_CHARS = 100_000
MAX_NODES = 20_000
MAX_PROBLEMS = 10

ALLOWED_MODULES = ("math", "statistics", "numpy", "pandas")

# Built-in names a strategy may not use.
DENIED_NAMES = {
    "eval": "eval runs text as code",
    "exec": "exec runs text as code",
    "compile": "compile builds code at run time",
    "open": "strategies cannot read or write files",
    "input": "strategies cannot read input",
    "breakpoint": "the debugger is not available",
    "globals": "globals() reaches outside the strategy",
    "locals": "locals() reaches outside the strategy",
    "vars": "vars() reaches object internals",
    "dir": "dir() lists object internals",
    "getattr": "getattr reaches attributes by name at run time",
    "setattr": "setattr changes attributes by name at run time",
    "delattr": "delattr removes attributes by name at run time",
    "hasattr": "hasattr reaches attributes by name at run time",
    "help": "help reads files",
    "memoryview": "memoryview reaches raw memory",
    "exit": "a strategy cannot stop the runner",
    "quit": "a strategy cannot stop the runner",
    "copyright": "not available",
    "credits": "not available",
    "license": "license reads files",
}

# Attribute names refused on any object.
DENIED_ATTRIBUTES = {
    # String formatting can read attributes by name ("{0.x}".format(obj)).
    "format": "str.format can read attributes by name; use an f-string",
    "format_map": "str.format_map can read attributes by name; use an f-string",
    "mro": "class internals are not available",
    # numpy / pandas: files, expressions, randomness, the clock.
    "load": "loading files is not allowed",
    "loads": "loading serialised data is not allowed",
    "save": "saving files is not allowed",
    "savez": "saving files is not allowed",
    "savez_compressed": "saving files is not allowed",
    "savetxt": "saving files is not allowed",
    "loadtxt": "reading files is not allowed",
    "genfromtxt": "reading files is not allowed",
    "fromfile": "reading files is not allowed",
    "tofile": "writing files is not allowed",
    "fromregex": "reading files is not allowed",
    "memmap": "memory-mapped files are not allowed",
    "DataSource": "reading files is not allowed",
    "ctypeslib": "native code is not allowed",
    "ctypes": "native code is not allowed",
    "f2py": "compiling code is not allowed",
    "distutils": "building code is not allowed",
    "testing": "test helpers are not available",
    "lib": "numpy.lib reads and writes files",
    "info": "numpy.info reads files",
    "source": "reading source files is not allowed",
    "lookfor": "reading files is not allowed",
    "show_config": "not available",
    "show_versions": "not available",
    "eval": "pandas.eval runs text as code",
    "query": "DataFrame.query runs text as code",
    "io": "pandas.io reads and writes files",
    "compat": "pandas internals are not available",
    "core": "pandas internals are not available",
    "api": "pandas internals are not available",
    "util": "pandas internals are not available",
    "plotting": "plotting is not available",
    "options": "pandas options are not available",
    "set_option": "pandas options are not available",
    "get_option": "pandas options are not available",
    "ExcelWriter": "writing files is not allowed",
    "HDFStore": "writing files is not allowed",
    "random": "randomness is not allowed: results must be repeatable",
    "sample": "random sampling is not allowed: results must be repeatable",
    "now": "the clock is not available: results must be repeatable",
    "today": "the clock is not available: results must be repeatable",
    "utcnow": "the clock is not available: results must be repeatable",
}

# Prefixes of attribute names refused on any object (frames, code, tracebacks).
DENIED_PREFIXES = ("f_", "gi_", "cr_", "ag_", "tb_", "co_", "read_")

# DataFrame/Series.to_* that only convert in memory; every other to_* writes out.
ALLOWED_TO = {
    "to_numpy",
    "to_list",
    "to_dict",
    "to_frame",
    "to_series",
    "to_records",
    "to_string",
    "to_datetime",
    "to_numeric",
    "to_timedelta",
    "to_period",
    "to_timestamp",
    "to_pydatetime",
    "to_datetime64",
    "to_offset",
}

# Indicator keys the catalogue offers (app.quant.indicators.catalogue).
INDICATOR_KEYS = ("SMA", "EMA", "RSI", "ATR", "MACD", "BOLLINGER", "ZSCORE", "ROLLING_VOLATILITY")


@dataclass(frozen=True)
class Problem:
    line: int
    message: str

    def text(self) -> str:
        return f"Line {self.line}: {self.message}"


class CodeRefused(ValueError):
    """The code was refused; `problems` says where and why."""

    def __init__(self, problems: list[Problem]):
        self.problems = problems
        super().__init__("; ".join(p.text() for p in problems))


@dataclass(frozen=True)
class IndicatorUse:
    key: str
    params: tuple[tuple[str, float], ...]
    line: int

    @property
    def id(self) -> str:
        return indicator_id(self.key, dict(self.params))


def indicator_id(key: str, params: dict) -> str:
    """The name both sides use for one indicator series, e.g. "SMA|period=20"."""
    parts = ",".join(f"{k}={_num(v)}" for k, v in sorted(params.items()))
    return f"{key.upper()}|{parts}"


def _num(value) -> str:
    value = float(value)
    return str(int(value)) if value.is_integer() else repr(value)


def _dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


def _attribute_problem(name: str) -> str | None:
    if name.startswith("_"):
        return "private and double-underscore attributes are not allowed"
    if name in DENIED_ATTRIBUTES:
        return f".{name} is not allowed ({DENIED_ATTRIBUTES[name]})"
    if name.startswith("to_") and name not in ALLOWED_TO:
        return f".{name} is not allowed (writing data out is not allowed)"
    for prefix in DENIED_PREFIXES:
        if name.startswith(prefix):
            reason = "reading files is not allowed" if prefix == "read_" else "interpreter internals are not available"
            return f".{name} is not allowed ({reason})"
    return None


class _Checker(ast.NodeVisitor):
    def __init__(self):
        self.problems: list[Problem] = []
        self.indicators: dict[str, IndicatorUse] = {}
        self._class_depth = 0

    def add(self, node: ast.AST, message: str) -> None:
        line = getattr(node, "lineno", 1) or 1
        if not any(p.line == line and p.message == message for p in self.problems):
            self.problems.append(Problem(line, message))

    # --- imports -------------------------------------------------------------
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name not in ALLOWED_MODULES:
                self.add(node, f"importing {alias.name} is not allowed (allowed: {', '.join(ALLOWED_MODULES)})")
            if alias.asname and _dunder(alias.asname):
                self.add(node, "double-underscore names are not allowed")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level or module not in ALLOWED_MODULES:
            shown = "." * node.level + module
            self.add(node, f"importing {shown} is not allowed (allowed: {', '.join(ALLOWED_MODULES)})")
            return
        for alias in node.names:
            if alias.name == "*":
                self.add(node, "import * is not allowed; import the names you need")
                continue
            problem = _attribute_problem(alias.name)
            if problem:
                self.add(node, f"from {module} import {alias.name}: {problem}")
            elif alias.name in DENIED_NAMES:
                self.add(node, f"{alias.name} is not allowed ({DENIED_NAMES[alias.name]})")

    # --- names and attributes --------------------------------------------------
    def visit_Name(self, node: ast.Name) -> None:
        if _dunder(node.id):
            self.add(node, f"{node.id} is not allowed (double-underscore names reach interpreter internals)")
        elif node.id in DENIED_NAMES:
            self.add(node, f"{node.id} is not allowed ({DENIED_NAMES[node.id]})")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        problem = _attribute_problem(node.attr)
        own = (
            isinstance(node.value, ast.Name)
            and node.value.id == "self"
            and node.attr.startswith("_")
            and not _dunder(node.attr)
        )
        if problem and not own:  # self._x on your own objects is fine
            self.add(node, problem)
        self.generic_visit(node)

    def visit_alias(self, node: ast.alias) -> None:  # covered by the import visitors
        return

    # --- definitions -----------------------------------------------------------
    def _function(self, node) -> None:
        if _dunder(node.name) and self._class_depth == 0:
            self.add(node, "double-underscore names are only allowed for methods of your own classes")
        for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            if _dunder(arg.arg):
                self.add(arg, "double-underscore names are not allowed")
        for arg in (node.args.vararg, node.args.kwarg):
            if arg is not None and _dunder(arg.arg):
                self.add(arg, "double-underscore names are not allowed")
        outer = self._class_depth
        self._class_depth = 0
        self.generic_visit(node)
        self._class_depth = outer

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.add(node, "async functions are not supported")

    def visit_Lambda(self, node: ast.Lambda) -> None:
        for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            if _dunder(arg.arg):
                self.add(node, "double-underscore names are not allowed")
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        if _dunder(node.name):
            self.add(node, "double-underscore names are not allowed")
        for keyword in node.keywords:
            self.add(node, f"class keyword {keyword.arg}= is not allowed")
        self._class_depth += 1
        self.generic_visit(node)
        self._class_depth -= 1

    def visit_Await(self, node) -> None:
        self.add(node, "async code is not supported")

    def visit_AsyncFor(self, node) -> None:
        self.add(node, "async code is not supported")

    def visit_AsyncWith(self, node) -> None:
        self.add(node, "async code is not supported")

    def visit_Global(self, node: ast.Global) -> None:
        for name in node.names:
            if _dunder(name):
                self.add(node, "double-underscore names are not allowed")

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self.visit_Global(node)  # same rule

    def visit_keyword(self, node: ast.keyword) -> None:
        if node.arg and _dunder(node.arg):
            self.add(node, "double-underscore names are not allowed")
        self.generic_visit(node)

    def visit_MatchClass(self, node) -> None:
        for name in node.kwd_attrs:
            problem = _attribute_problem(name)
            if problem:
                self.add(node, problem)
        self.generic_visit(node)

    def visit_MatchAs(self, node) -> None:
        if node.name and _dunder(node.name):
            self.add(node, "double-underscore names are not allowed")
        self.generic_visit(node)

    # --- context.indicator(...) needs fixed arguments ------------------------------
    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "indicator":
            self._indicator(node)
        self.generic_visit(node)

    def _indicator(self, node: ast.Call) -> None:
        if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
            self.add(node, 'context.indicator needs the indicator\'s name as text, e.g. context.indicator("SMA", period=20)')
            return
        if len(node.args) > 1:
            self.add(node, "context.indicator takes the name, then named numbers, e.g. period=20")
            return
        key = node.args[0].value.upper()
        if key not in INDICATOR_KEYS:
            self.add(node, f'unknown indicator "{node.args[0].value}" (available: {", ".join(INDICATOR_KEYS)})')
            return
        params: dict[str, float] = {}
        for keyword in node.keywords:
            if keyword.arg is None:
                self.add(node, "context.indicator needs named numbers, not **")
                return
            if keyword.arg == "ago":
                continue  # how many bars back; may change at run time
            value = keyword.value
            negative = isinstance(value, ast.UnaryOp) and isinstance(value.op, ast.USub)
            inner = value.operand if negative else value
            if not isinstance(inner, ast.Constant) or isinstance(inner.value, bool) or not isinstance(inner.value, (int, float)):
                self.add(
                    node,
                    f"context.indicator needs fixed numbers so it can be computed ahead; {keyword.arg}= is not a number",
                )
                return
            params[keyword.arg] = -inner.value if negative else inner.value
        use = IndicatorUse(key, tuple(sorted(params.items())), node.lineno)
        self.indicators.setdefault(use.id, use)


def _entry_point(tree: ast.Module) -> list[Problem]:
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == ENTRY_POINT]
    if not functions:
        return [Problem(1, f"the code must define {ENTRY_POINT}(context) at the top level")]
    args = functions[-1].args
    positional = args.posonlyargs + args.args
    if len(positional) != 1 or args.vararg is not None or args.kwonlyargs or args.kwarg is not None:
        return [Problem(functions[-1].lineno, f"{ENTRY_POINT} must take exactly one argument: context")]
    return []


def parse(code: str) -> ast.Module:
    if not isinstance(code, str) or not code.strip():
        raise CodeRefused([Problem(1, "the code is empty")])
    if len(code) > MAX_CODE_CHARS:
        raise CodeRefused([Problem(1, f"the code is longer than {MAX_CODE_CHARS} characters")])
    if "\x00" in code:
        raise CodeRefused([Problem(1, "the code contains a null character")])
    try:
        tree = ast.parse(code, filename="<strategy>")
    except SyntaxError as exc:
        raise CodeRefused([Problem(exc.lineno or 1, f"syntax error: {exc.msg}")]) from None
    except (ValueError, RecursionError, MemoryError):
        raise CodeRefused([Problem(1, "the code could not be read (too deeply nested?)")]) from None
    return tree


def check(code: str) -> list[IndicatorUse]:
    """Refuses the code (CodeRefused) or returns the indicators it uses."""
    tree = parse(code)
    nodes = sum(1 for _ in ast.walk(tree))
    if nodes > MAX_NODES:
        raise CodeRefused([Problem(1, f"the code is too large ({nodes} syntax nodes; at most {MAX_NODES})")])
    checker = _Checker()
    try:
        checker.visit(tree)
    except RecursionError:
        raise CodeRefused([Problem(1, "the code is too deeply nested")]) from None
    problems = sorted(checker.problems, key=lambda p: p.line) + _entry_point(tree)
    if problems:
        raise CodeRefused(problems[:MAX_PROBLEMS])
    return sorted(checker.indicators.values(), key=lambda u: u.id)
