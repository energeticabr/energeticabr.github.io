"""Export an actual fake-engine/channel poll; no live rows or credentials."""
import argparse
import importlib.util
import json
from pathlib import Path


def export(output):
    source = Path(__file__).parent / 'tests/test_asset_group.py'
    spec = importlib.util.spec_from_file_location('asset_group_preview_fixture', source)
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    case = fixture.AssetGroupTests()
    case.setUp()
    try:
        case.open_product()
        poll = case.assert_create_first()
        result = {'question': poll['question'],
                  'options': [{key: option[key] for key in ('id', 'reply', 'label')}
                              for option in poll['options']],
                  'databaseFilter': poll['databaseFilter'],
                  'databaseFilterKey': poll['databaseFilterKey']}
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return result
    finally:
        case.doCleanups()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = export(args.output)
    print(json.dumps({'output': str(args.output), 'first': result['options'][0]}, ensure_ascii=False))
