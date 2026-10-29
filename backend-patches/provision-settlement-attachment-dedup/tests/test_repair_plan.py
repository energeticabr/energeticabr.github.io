import hashlib
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('duplicate_repair',Path(__file__).resolve().parents[1]/'repair_duplicates.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def test_only_own_generated_duplicate_with_confirmed_source_and_retained_original_is_selected():
    digest = hashlib.sha256(b'proof').hexdigest()
    generated = 'PROV-11-'+digest+'-proof.pdf'
    foreign = 'PROV-12-'+digest+'-proof.pdf'
    files = {'proof.pdf':digest, generated:digest, foreign:digest, 'other.pdf':'a'*64}
    assert repair.duplicate_plan(files,{'proof.pdf':digest},11) == [
        {'remove':generated,'retain':'proof.pdf','sha256':digest}]


def test_unique_generated_file_and_two_manual_originals_are_preserved():
    digest = 'b'*64
    files = {'PROV-11-'+digest+'-only.pdf':digest,'one.pdf':'a'*64,'two.pdf':'a'*64}
    assert repair.duplicate_plan(files,{'only.pdf':digest},11) == []


def test_forged_digest_and_missing_source_are_preserved():
    digest = 'b'*64
    files = {'PROV-11-'+'a'*64+'-proof.pdf':digest,'proof.pdf':digest}
    assert repair.duplicate_plan(files,{'proof.pdf':digest},11) == []
    files = {'PROV-11-'+digest+'-proof.pdf':digest,'proof.pdf':digest}
    assert repair.duplicate_plan(files,{},11) == []
