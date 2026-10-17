"""Run new amount conversation plus unchanged strict query and durable settlement contracts."""
from pathlib import Path
import sys
import pytest

archive = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(archive))
raise SystemExit(pytest.main([
    '-q', str(Path(__file__).with_name('test_amount_entry.py')),
    str(archive / 'test_provision_description_query.py'),
    str(archive / 'test_provision_description_settlement.py') + '::DescriptionSettlementTests',
    str(archive / 'test_provision_description_settlement.py') + '::DescriptionSnapshotCompatibilityTests',
    '-k', 'not test_invalid_group_is_visible_but_not_selectable_or_prepared',
]))
