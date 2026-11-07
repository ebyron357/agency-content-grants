"""Extracts the federal form definitions Grant Studio uses from HHS/simpler-grants-gov.

Source: https://github.com/HHS/simpler-grants-gov (api/src/form_schema/forms/),
a work of the United States government in the public domain, with a CC0 1.0
waiver worldwide (its LICENSE.md). The output keeps each form's JSON Schema
(with the shared schemas it references inlined), its UI layout (sections and
field order), its pre-population rules and its identifying metadata. The XML
transform rules are left out: Grant Studio never submits to Grants.gov.

The checkout is never imported or run. Each file is parsed with `ast` and only
a small, closed set of constructs is evaluated: literals, names bound earlier
in the same file (or in the shared schema files), `SHARED.field_ref("x")`,
`uuid.UUID("...")`, `date(y, m, d)`, list comprehensions and `*` unpacking over
those values, and the `Form(...)` / `SharedSchema(...)` constructors (read as
plain keyword arguments). Anything else stops the script with an error.

Usage (Python 3.10+):

    git clone --depth 1 --filter=blob:none --sparse https://github.com/HHS/simpler-grants-gov.git sgg
    git -C sgg sparse-checkout set api/src/form_schema
    python3 -I artifacts/api-server/scripts/extract-federal-forms.py sgg \
        artifacts/api-server/src/lib/grants/federalForms/definitions.ts
"""

import ast
import copy
import json
import subprocess
import sys
from pathlib import Path

FORMS = ["sf424", "sf424a", "sf424b", "sflll"]
SHARED_BASE = "https://files.simpler.grants.gov/schemas"


class Ref:
    """A shared schema object: `field_ref` builds a $ref into it."""

    def __init__(self, name: str, schema: object) -> None:
        self.uri = f"{SHARED_BASE}/{name}.json"
        self.schema = schema


class Enum:
    """A framework enum such as FormType: its members read as their names."""


class Call:
    def __init__(self, name: str, kwargs: dict) -> None:
        self.name = name
        self.kwargs = kwargs


def evaluate(node: ast.AST, scope: dict) -> object:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Dict):
        out: dict = {}
        for k, v in zip(node.keys, node.values):
            if k is None:
                out.update(evaluate(v, scope))  # type: ignore[arg-type]
            else:
                out[evaluate(k, scope)] = evaluate(v, scope)
        return out
    if isinstance(node, (ast.List, ast.Tuple)):
        items: list = []
        for elt in node.elts:
            if isinstance(elt, ast.Starred):
                items.extend(evaluate(elt.value, scope))  # type: ignore[arg-type]
            else:
                items.append(evaluate(elt, scope))
        return items
    if isinstance(node, ast.Name):
        if node.id in scope:
            return scope[node.id]
        raise ValueError(f"unknown name {node.id} at line {node.lineno}")
    if isinstance(node, ast.Attribute):
        base = evaluate(node.value, scope)
        if isinstance(base, dict) and node.attr in base:
            return base[node.attr]
        if isinstance(base, Enum):
            return node.attr
        raise ValueError(f"unsupported attribute {node.attr} at line {node.lineno}")
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return evaluate(node.left, scope) + evaluate(node.right, scope)  # type: ignore[operator]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -evaluate(node.operand, scope)  # type: ignore[operator]
    if isinstance(node, ast.JoinedStr):
        parts = []
        for value in node.values:
            if isinstance(value, ast.FormattedValue):
                parts.append(str(evaluate(value.value, scope)))
            else:
                parts.append(str(evaluate(value, scope)))
        return "".join(parts)
    if isinstance(node, ast.ListComp) and len(node.generators) == 1 and not node.generators[0].ifs:
        gen = node.generators[0]
        if not isinstance(gen.target, ast.Name):
            raise ValueError(f"unsupported comprehension at line {node.lineno}")
        return [evaluate(node.elt, {**scope, gen.target.id: item}) for item in evaluate(gen.iter, scope)]  # type: ignore[union-attr]
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "field_ref":
            shared = evaluate(func.value, scope)
            if not isinstance(shared, Ref):
                raise ValueError(f"field_ref on a non-shared value at line {node.lineno}")
            return f"{shared.uri}#/{evaluate(node.args[0], scope)}"
        name = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else None
        if name == "UUID":
            return str(evaluate(node.args[0], scope))
        if name == "date":
            y, m, d = (evaluate(a, scope) for a in node.args)
            return f"{y:04d}-{m:02d}-{d:02d}"
        if name in ("Form", "SharedSchema"):
            kwargs: dict = {}
            for kw in node.keywords:
                try:
                    kwargs[kw.arg] = evaluate(kw.value, scope)
                except ValueError:
                    kwargs[kw.arg] = None  # For example the XML transform rules, which are not extracted.
            return Call(name, kwargs)
        raise ValueError(f"unsupported call {name} at line {node.lineno}")
    raise ValueError(f"unsupported construct {type(node).__name__} at line {getattr(node, 'lineno', '?')}")


def read_module(path: Path, scope: dict) -> dict:
    """Evaluates the module's top-level assignments in order; imports are resolved from `scope`."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = dict(scope)
    for stmt in tree.body:
        if isinstance(stmt, (ast.Import, ast.ImportFrom, ast.Expr)):
            continue  # Imports come from `scope`; bare expressions are docstrings.
        if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
            if stmt.value is None:
                continue
            try:
                value = evaluate(stmt.value, names)
            except ValueError as err:
                # Only the schemas are needed; skip helpers this reader does not understand.
                skipped = ", ".join(t.id for t in targets if isinstance(t, ast.Name))
                print(f"{path.name}: skipped {skipped}: {err}", file=sys.stderr)
                continue
            for target in targets:
                if isinstance(target, ast.Name):
                    names[target.id] = value
            continue
        # Functions and classes are not needed for the schema and are not evaluated.
    return names


def main() -> None:
    checkout = Path(sys.argv[1]).resolve()
    out_path = Path(sys.argv[2]).resolve()
    root = checkout / "api" / "src" / "form_schema"
    constants = read_module(root / "shared" / "shared_form_constants.py", {})
    shared_scope: dict = {"shared_form_constants": constants}
    common = read_module(root / "shared" / "common_shared.py", shared_scope)
    address = read_module(root / "shared" / "address_shared.py", shared_scope)

    def shared(module: dict, name: str) -> Ref:
        call = module[name]
        assert isinstance(call, Call) and call.name == "SharedSchema", name
        return Ref(call.kwargs["schema_name"], call.kwargs["json_schema"])

    common_ref = shared(common, "COMMON_SHARED_V1")
    address_ref = shared(address, "ADDRESS_SHARED_V1")
    shared_by_uri = {r.uri: r.schema for r in (common_ref, address_ref)}

    def resolve(node: object, base: str | None = None) -> object:
        """Inlines references to the shared schemas. A `#/x` reference inside a shared
        schema points into that shared schema; the form's own `#/$defs` references stay."""
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and (not ref.startswith("#") or base is not None):
                uri, _, pointer = (base + ref) .partition("#/") if ref.startswith("#") else ref.partition("#/")
                target: object = shared_by_uri[uri]
                for part in pointer.split("/"):
                    target = target[part]  # type: ignore[index]
                merged = copy.deepcopy(resolve(target, uri))
                assert isinstance(merged, dict)
                merged.update({k: resolve(v, base) for k, v in node.items() if k != "$ref"})
                return merged
            return {k: resolve(v, base) for k, v in node.items()}
        if isinstance(node, list):
            return [resolve(v, base) for v in node]
        return node

    commit = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    form_scope = {"COMMON_SHARED_V1": common_ref, "ADDRESS_SHARED_V1": address_ref, "NO_VALUE": "__NO_VALUE__", "FormType": Enum()}
    definitions = {}
    for key in FORMS:
        path = root / "forms" / key / "1" / "0" / "form_json.py"
        module = read_module(path, form_scope)
        form = next(v for v in module.values() if isinstance(v, Call) and v.name == "Form")
        meta = form.kwargs
        definitions[key] = {
            "key": key,
            "formName": meta["form_name"],
            "shortFormName": meta["short_form_name"],
            "formVersion": meta["form_version"],
            "ombNumber": meta.get("omb_number"),
            "expirationDate": meta.get("expiration_date"),
            "legacyFormId": meta.get("legacy_form_id"),
            "simplerFormId": meta["form_id"],
            "sourcePath": f"api/src/form_schema/forms/{key}/1/0/form_json.py",
            "jsonSchema": resolve(module["FORM_JSON_SCHEMA"]),
            "uiSchema": resolve(module["FORM_UI_SCHEMA"]),
            "ruleSchema": resolve(module.get("FORM_RULE_SCHEMA") or {}),
        }
    body = json.dumps(definitions, indent=1, ensure_ascii=False)
    out_path.write_text(
        "// Generated by artifacts/api-server/scripts/extract-federal-forms.py. Do not edit by hand.\n"
        "// Source: https://github.com/HHS/simpler-grants-gov at commit " + commit + ",\n"
        "// api/src/form_schema/forms/ (a US government work in the public domain; CC0 1.0 waiver worldwide).\n"
        'import type { FederalFormDefinition, FederalFormKey } from "./types";\n\n'
        f'export const SOURCE_COMMIT = "{commit}";\n\n'
        f"export const FEDERAL_FORM_DEFINITIONS: Record<FederalFormKey, FederalFormDefinition> = {body};\n",
        encoding="utf-8",
    )
    print(f"Wrote {out_path} from {commit}: {', '.join(definitions)}")


if __name__ == "__main__":
    main()
