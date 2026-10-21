import ast

PYTHON_CODE_MAX_LENGTH = 100_000
ENTRY_POINT = "generate_signal"


def check_python_code(code: str) -> str:
    """Checks the shape of a Python strategy without running it.

    ast.parse only builds a syntax tree: nothing in the code is executed or
    imported. This is the shape check used when the code is saved; the full
    safety check (app.sandbox.guard) runs when it is backtested, validated or
    test-run in the isolated sandbox (Feature 6).
    """
    if not code.strip():
        raise ValueError("Python code is empty.")
    if len(code) > PYTHON_CODE_MAX_LENGTH:
        raise ValueError(
            f"Python code is longer than {PYTHON_CODE_MAX_LENGTH} characters."
        )

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise ValueError(
            f"Python syntax error on line {exc.lineno}: {exc.msg}."
        ) from exc
    except (ValueError, RecursionError, MemoryError) as exc:
        raise ValueError("Python code could not be read.") from exc

    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == ENTRY_POINT
    ]
    if not functions:
        raise ValueError(
            f"Python code must define {ENTRY_POINT}(context) at the top level."
        )

    args = functions[-1].args
    positional = args.posonlyargs + args.args
    if (
        len(positional) != 1
        or args.vararg is not None
        or args.kwonlyargs
        or args.kwarg is not None
    ):
        raise ValueError(f"{ENTRY_POINT} must take exactly one argument: context.")

    return code
