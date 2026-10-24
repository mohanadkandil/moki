"""Conservative AST preflight for model-generated CAD; not a security sandbox.

Execution is additionally confined to the dedicated Daytona worker and deadline.
"""
import ast
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
assert len(source) <= 45000, 'CAD source too large'
tree = ast.parse(source)
allowed = {'build123d', 'math', 'json', 'pathlib', 'cadpy.assembly'}
blocked = {'eval', 'exec', 'compile', 'open', '__import__', 'getattr', 'setattr', 'delattr',
           'globals', 'locals', 'vars', 'input', 'breakpoint', 'help', 'exit', 'quit',
           'export_step', 'export_stl', 'export_gltf', 'import_step', 'Mesher'}
blocked_attributes = {'write_text', 'write_bytes', 'unlink', 'rmdir', 'mkdir', 'rename', 'replace',
                      'chmod', 'touch', 'open', 'read_bytes', 'glob', 'rglob', 'iterdir',
                      'export_step', 'export_stl', 'export_gltf', 'import_step', 'read', 'write'}
assert any(isinstance(n, ast.FunctionDef) and n.name == 'gen_step' for n in tree.body), 'Missing gen_step()'
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        assert all(item.name in allowed for item in node.names), 'Unapproved import'
    if isinstance(node, ast.ImportFrom):
        assert node.level == 0 and node.module in allowed, 'Unapproved import'
        assert all(not item.name.startswith('_') for item in node.names), 'Private import'
    if isinstance(node, ast.Name):
        assert node.id not in blocked, 'Unsafe builtin'
        assert not node.id.startswith('__') or node.id == '__file__', 'Private name'
    if isinstance(node, ast.Attribute):
        assert not node.attr.startswith('_') and node.attr not in blocked_attributes, 'Unsafe attribute'
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        if node.func.id == 'Path':
            assert len(node.args) == 1 and isinstance(node.args[0], ast.Name) and node.args[0].id == '__file__', 'Only geometry Path allowed'
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        if node.func.attr == 'with_name':
            assert len(node.args) == 1 and isinstance(node.args[0], ast.Constant) and node.args[0].value == 'pcb-geometry.json', 'Only geometry input allowed'
        if node.func.attr == 'read_text':
            assert ast.unparse(node.func.value) == "Path(__file__).with_name('pcb-geometry.json')", 'Only geometry input readable'
print('CAD_SOURCE_OK')
