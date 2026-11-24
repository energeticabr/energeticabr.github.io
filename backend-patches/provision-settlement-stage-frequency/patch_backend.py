"""Narrow patch to rank stages in provision settlement by recent usage."""

from pathlib import Path
import sys


def patch(relative, data):
    if relative != "worker/workflow.py":
        raise RuntimeError("Unexpected source: " + relative)
    text = data.decode("utf-8")
    old_guard = '''        if state.get("flow") != "launch" or step.get("key") != "etapa_lancamento" or not options:
            return options
'''
    new_guard = '''        is_launch_stage = (
            state.get("flow") == "launch" and step.get("key") == "etapa_lancamento"
        )
        is_settlement_stage = (
            state.get("flow") == "payment_settlement" and step.get("key") == "etapa_baixa"
        )
        if not (is_launch_stage or is_settlement_stage) or not options:
            return options
'''
    old_return = '''            return sorted(options, key=lambda item: -counts.get(
                normalize_text(str(item.get("value") or "")), 0))
        except Exception:
            # A history outage must never remove catalog choices or block launch.
            return options
'''
    new_return = '''            return sorted(options, key=lambda item: (
                0 if is_settlement_stage and str(item.get("id") or "") == "NOVA_ETAPA_BAIXA_PROVISAO" else 1,
                -counts.get(normalize_text(str(item.get("value") or "")), 0),
            ))
        except Exception:
            # A history outage must never remove catalog choices or block either flow.
            return options
'''
    if text.count(old_guard) != 1 or text.count(old_return) != 1:
        raise RuntimeError("Recent stage ranking source anchor drift")
    text = text.replace(old_guard, new_guard, 1).replace(old_return, new_return, 1)
    return text.encode("utf-8")


if __name__ == "__main__":
    root = Path(sys.argv[1])
    relative = "worker/workflow.py"
    target = root / relative
    target.write_bytes(patch(relative, target.read_bytes()))
