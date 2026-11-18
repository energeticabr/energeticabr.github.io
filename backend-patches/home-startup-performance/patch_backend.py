"""Replace exactly one menu method; preserve every unrelated workflow byte."""
import ast
from pathlib import Path


def patch(relative, data):
    if relative != 'worker/workflow.py':
        raise RuntimeError('Unexpected patch scope')
    tree = ast.parse(data.decode('utf-8'))
    methods = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
               and node.name == '_start_group_menu_options']
    if len(methods) != 1:
        raise RuntimeError('Menu source anchor drift')
    method = methods[0]
    lines = data.decode('utf-8').splitlines(keepends=True)
    replacement = Path(__file__).with_name('menu_method.py').read_text(encoding='utf-8')
    replacement = ''.join('    ' + line if line.strip() else line
                          for line in replacement.splitlines(keepends=True)).rstrip() + '\n'
    result = ''.join(lines[:method.lineno - 1]) + replacement + ''.join(lines[method.end_lineno:])
    compile(result, relative, 'exec')
    return result.encode('utf-8')
