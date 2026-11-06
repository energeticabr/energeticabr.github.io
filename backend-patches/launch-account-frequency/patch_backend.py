"""Pinned narrow account-order patch for the shared payment workflow."""
from pathlib import Path
import sys


def patch(relative, data):
    if relative != 'worker/workflow.py':
        raise RuntimeError('Unexpected source: ' + relative)
    text = data.decode('utf-8')
    old = '        return self._rank_recent_launch_stage_options(state, step, normalized)\n'
    new = '''        normalized = self._rank_recent_launch_stage_options(state, step, normalized)
        return self._rank_recent_launch_account_options(state, step, normalized)

    def _rank_recent_launch_account_options(self, state, step, options):
        """Rank account choices by use in the latest 100 launches, read only."""
        if state.get("flow") != "launch" or step.get("key") != "conta_lancamento" or not options:
            return options
        try:
            rows = self.sharepoint.get_options({
                "key": "recent_launch_account_usage",
                "source": {
                    "type": "sharepoint_list", "list": "LANCAMENTOS",
                    "id_field": "Id", "label_field": "Id", "value_field": "CONTA",
                    "fields": ["Id", "CONTA"], "top": 100,
                    "sort_field": "Id", "sort_direction": "desc",
                    "preserve_source_order": True,
                },
            }, {})
            rows = sorted(rows, key=lambda row: int(row["id"]), reverse=True)[:100]
            counts = {}
            for row in rows:
                account = normalize_text(str(row.get("value") or ""))
                if account:
                    counts[account] = counts.get(account, 0) + 1
            return sorted(options, key=lambda item: -counts.get(
                normalize_text(str(item.get("value") or "")), 0))
        except Exception:
            # History availability must not block payment or remove catalog choices.
            return options
'''
    if text.count(old) != 1:
        raise RuntimeError('Account selector source anchor drift')
    return text.replace(old, new, 1).encode('utf-8')


if __name__ == '__main__':
    root = Path(sys.argv[1])
    relative = 'worker/workflow.py'
    target = root / relative
    target.write_bytes(patch(relative, target.read_bytes()))
