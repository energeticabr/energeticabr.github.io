"""Read contracts against a synthetic SharePoint REST boundary (no live data)."""

import copy
import importlib
import json
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote

import pytest
import requests


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))

from clients import SharePointClient  # noqa: E402


PARENT = "DESCRITIVOPROVISAO"
CHILD = "PROVISÃO PGTOS"
PARENT_SCHEMA = {
    "Id": "Id",
    "FORNECEDOR": "parent_supplier",
    "FILIAL": "parent_branch",
    "OBS": "parent_notes",
    "FORMAPGTO": "parent_method",
    "DATAPREVISTOPGTO": "parent_due",
    "DATAPGTOEFETUADO": "parent_paid_date",
    "PGTOAGENDADO": "parent_paid",
    "VALORTOTAL": "parent_stored_total",
}
CHILD_SCHEMA = {
    "Id": "Id",
    "DESCRITIVOPROVISAO": "child_parent_text",
    "FORNECEDOR": "child_supplier",
    "FILIAL": "child_branch",
    "IMOVEL": "child_property",
    "PRODUTO": "child_product",
    "QTD": "child_quantity",
    "VALOR TOTAL": "child_unit",
    "FRETE": "child_freight",
    "OBS": "child_notes",
    "IDLANCAMENTOS": "child_launch",
    "IDPEDIDO": "child_order",
    "DATA PREVISTO PGTO": "child_due",
    "DATA PGTO EFETUADO": "child_paid_date",
    "FORMAPGTO": "child_method",
    "STATUS": "child_status",
    "PGTOAGENDADO": "child_paid",
}


def parent(item_id=42, **changes):
    row = {
        "Id": item_id,
        "FORNECEDOR": "Supplier example",
        "FILIAL": "Branch example",
        "OBS": "Parent notes",
        "FORMAPGTO": "PIX",
        "DATAPREVISTOPGTO": "2026-10-12T03:00:00Z",
        "DATAPGTOEFETUADO": None,
        "PGTOAGENDADO": None,
        "VALORTOTAL": "999",
    }
    row.update(changes)
    return row


def child(item_id=1, parent_id="42", **changes):
    row = {
        "Id": item_id,
        "DESCRITIVOPROVISAO": parent_id,
        "FORNECEDOR": "Child supplier",
        "FILIAL": "Child branch",
        "IMOVEL": "Property example",
        "PRODUTO": "Product example",
        "QTD": "2.5",
        "VALOR TOTAL": "10.10",
        "FRETE": "1.25",
        "OBS": "Child notes",
        "IDLANCAMENTOS": "100",
        "IDPEDIDO": "200",
        "DATA PREVISTO PGTO": "2026-10-13T03:00:00Z",
        "DATA PGTO EFETUADO": None,
        "FORMAPGTO": "TRANSFERÊNCIA",
        "STATUS": "PAGAMENTO PREVISTO",
        "PGTOAGENDADO": None,
    }
    row.update(changes)
    return row


class SyntheticRest(SharePointClient):
    """Keep production mapping; replace only the authenticated REST transport."""

    def __init__(self, parents=None, children=None, optional=None):
        super().__init__(
            "example.sharepoint.com", "sites/test", "tenant", "client",
            "synthetic-key", "synthetic-certificate", CHILD,
        )
        self.schemas = {PARENT: dict(PARENT_SCHEMA), CHILD: dict(CHILD_SCHEMA)}
        self.schemas[CHILD].update(optional or {})
        self.rows = {
            PARENT: [parent()] if parents is None else parents,
            CHILD: [child()] if children is None else children,
        }
        self.overrides = {}
        self.calls = []

    def encoded(self, list_title, rows):
        return [
            {internal: row.get(field) for field, internal in self.schemas[list_title].items()}
            for row in rows
        ]

    def _request(self, method, endpoint, **kwargs):
        assert method == "GET", "This slice must never write production data"
        self.calls.append((endpoint, copy.deepcopy(kwargs.get("params"))))
        if endpoint in self.overrides:
            response = self.overrides[endpoint]
            if isinstance(response, Exception):
                raise response
            return copy.deepcopy(response)
        for list_title, schema in self.schemas.items():
            base = self._list_endpoint(list_title)
            if endpoint == base + "/fields":
                return {"value": [
                    {"Title": title, "InternalName": name, "StaticName": name,
                     "TypeAsString": "Counter" if title == "Id" else "Text",
                     "ReadOnlyField": title == "Id"}
                    for title, name in schema.items()
                ]}
            if endpoint.startswith(base + "/items"):
                selected = (kwargs.get("params") or {}).get("$select", "").split(",")
                assert set(selected) <= set(schema.values()), "Unsupported selected column"
                encoded = self.encoded(list_title, self.rows[list_title])
                if endpoint == base + "/items":
                    return {"value": encoded}
                item_id = int(endpoint.rsplit("(", 1)[1].rstrip(")"))
                matches = [row for row in encoded if row[schema["Id"]] == item_id]
                if not matches:
                    response = requests.Response()
                    response.status_code = 404
                    raise requests.HTTPError("Synthetic item missing", response=response)
                if kwargs.get("_return_response"):
                    response = requests.Response()
                    response.status_code = 200
                    response._content = json.dumps(matches[0]).encode("utf-8")
                    response.headers["ETag"] = '"synthetic-version"'
                    return response
                return matches[0]
        raise AssertionError("Unexpected synthetic REST endpoint")


def query(client, **limits):
    module = importlib.import_module("provision_description_query")
    return module.ProvisionDescriptionQuery(client, **limits)


def test_pending_group_projects_canonical_fields_and_all_children_exactly():
    paid = child(9, **{"QTD": "3", "VALOR TOTAL": "1.005", "FRETE": "",
                       "STATUS": "PAGO", "PGTOAGENDADO": "PAGO"})
    client = SyntheticRest(children=[paid, child(2)])

    groups = client.get_pending_provision_descriptions()

    assert len(groups) == 1
    group = groups[0]
    assert group["Id"] == 42
    assert group["FORNECEDOR"] == "Supplier example"
    assert group["FILIAL"] == "Branch example"
    assert group["OBS"] == "Parent notes"
    assert group["FORMAPGTO"] == "PIX"
    assert group["DATA PREVISTO PGTO"] == "2026-10-12T03:00:00Z"
    assert group["DATA PGTO EFETUADO"] is None
    assert group["PGTOAGENDADO"] is None
    assert group["VALORTOTAL"] == "999"
    assert group["VALOR TOTAL DESCRITIVO"] == "29.515"
    assert group["totalDisplay"] == "R$ 29,52"
    assert group["PENDING CHILD IDS"] == ["2"]
    assert group["sourceKind"] == "provision-description"
    assert group["CHILDREN"] == [child(2), paid]
    assert "QTD" not in group and "PRODUTO" not in group
    assert "DATAPREVISTOPGTO" not in group


def test_paid_parent_with_pending_child_remains_available_for_partial_retry():
    client = SyntheticRest(parents=[parent(DATAPGTOEFETUADO="2026-10-11", PGTOAGENDADO="PAGO")])

    group = client.get_pending_provision_descriptions()[0]

    assert group["DATA PGTO EFETUADO"] == "2026-10-11"
    assert group["PGTOAGENDADO"] == "PAGO"
    assert group["PENDING CHILD IDS"] == ["1"]


@pytest.mark.parametrize("changes", [
    {"STATUS": "PAGO"},
    {"DATA PGTO EFETUADO": "2026-10-10"},
    {"PGTOAGENDADO": " pago "},
    {"STATUS": None},
])
def test_excludes_groups_with_no_pending_children(changes):
    assert SyntheticRest(children=[child(**changes)]).get_pending_provision_descriptions() == []


def test_blank_payment_date_and_normalized_pending_status_are_pending():
    row = child(**{"STATUS": " pagamento previsto ", "DATA PGTO EFETUADO": "  "})
    assert SyntheticRest(children=[row]).get_pending_provision_descriptions()[0]["PENDING CHILD IDS"] == ["1"]


def test_orders_groups_by_parent_due_date_then_numeric_parent_id_and_children():
    parents = [parent(10, DATAPREVISTOPGTO=None),
               parent(9, DATAPREVISTOPGTO="2026-10-11"),
               parent(2, DATAPREVISTOPGTO="11/10/2026"),
               parent(3, DATAPREVISTOPGTO="2026-10-09")]
    children = [child(10, "2"), child(2, "2"), child(3, "3"), child(4, "9"), child(5, "10")]

    groups = SyntheticRest(parents, children).get_pending_provision_descriptions()

    assert [group["Id"] for group in groups] == [3, 2, 9, 10]
    assert groups[1]["PENDING CHILD IDS"] == ["2", "10"]


def test_only_exact_textual_parent_link_groups_children_not_id_collisions():
    children = [child(42, None, QTD="invalid"), child(41, "142"),
                child(40, "0042"), child(39, "42.0"), child(38, "42 suffix"),
                child(37, " 42 "), child(36, "", QTD="invalid")]
    groups = SyntheticRest(children=children).get_pending_provision_descriptions()
    assert [row["Id"] for row in groups[0]["CHILDREN"]] == [37]
    assert groups[0]["VALOR TOTAL DESCRITIVO"] == "26.5"


@pytest.mark.parametrize("optional", [
    {}, {"ETAPA": "child_stage"}, {"TIPO DESPESA": "child_expense"},
    {"ETAPA": "child_stage", "TIPO DESPESA": "child_expense"},
])
def test_optional_child_fields_selected_only_when_schema_supports_them(optional):
    row = child(ETAPA="FUNDAÇÃO", **{"TIPO DESPESA": "MATERIAL"})
    client = SyntheticRest(children=[row], optional=optional)
    result = client.get_pending_provision_descriptions()[0]["CHILDREN"][0]
    for name in ("ETAPA", "TIPO DESPESA"):
        if name in optional:
            assert result[name] == row[name]
        else:
            assert name not in result
    item_calls = [(endpoint, params) for endpoint, params in client.calls if endpoint.endswith("/items")]
    assert all("$filter" not in params for _, params in item_calls)


def test_reusable_rest_adapter_query_has_same_read_contract():
    assert query(SyntheticRest()).get_pending_provision_descriptions()[0]["VALOR TOTAL DESCRITIVO"] == "26.5"


def test_live_schema_id_and_short_internal_names_still_project_canonical_rows():
    client = SyntheticRest()
    client.schemas[PARENT] = {field: field for field in PARENT_SCHEMA}
    client.schemas[CHILD] = {field: field for field in CHILD_SCHEMA}
    client.schemas[PARENT]["Id"] = "ID"
    client.schemas[CHILD].update({
        "Id": "ID", "VALOR TOTAL": "VALORTOTAL",
        "DATA PREVISTO PGTO": "DATAPREVISTOPGTO",
        "DATA PGTO EFETUADO": "DATAPGTOEFETUADO",
    })
    pending = client.get_pending_provision_descriptions()[0]
    fresh = client.get_provision_description(42)
    assert fresh == pending
    assert fresh["Id"] == 42
    assert fresh["VALORTOTAL"] == "999"
    assert fresh["VALOR TOTAL DESCRITIVO"] == "26.5"
    assert fresh["CHILDREN"][0]["VALOR TOTAL"] == "10.10"
    assert fresh["CHILDREN"][0]["Id"] == 1


@pytest.mark.parametrize("next_key", ["odata.nextLink", "@odata.nextLink", "verbose"])
def test_reads_every_parent_and_child_page(next_key):
    client = SyntheticRest()
    for title, first, second in ((PARENT, parent(2), parent(42)),
                                 (CHILD, child(2, "2"), child(3, "42"))):
        endpoint = client._list_endpoint(title) + "/items"
        next_endpoint = client.site_url + "/_api/" + endpoint + "?$skiptoken=page2"
        if next_key == "verbose":
            client.overrides[endpoint] = {"d": {"results": client.encoded(title, [first]), "__next": next_endpoint}}
            client.overrides[next_endpoint] = {"d": {"results": client.encoded(title, [second])}}
        else:
            client.overrides[endpoint] = {"value": client.encoded(title, [first]), next_key: next_endpoint}
            client.overrides[next_endpoint] = {"value": client.encoded(title, [second])}

    groups = client.get_pending_provision_descriptions()

    assert [group["Id"] for group in groups] == [2, 42]
    assert [group["PENDING CHILD IDS"] for group in groups] == [["2"], ["3"]]
    assert all(params is None for endpoint, params in client.calls if "$skiptoken" in endpoint)


def test_optional_schema_field_on_later_page_is_not_lost():
    client = SyntheticRest(optional={"ETAPA": "child_stage"})
    endpoint = client._list_endpoint(CHILD) + "/fields"
    next_endpoint = client.site_url + "/_api/" + endpoint + "?$skiptoken=fields2"
    schema = [{"Title": title, "InternalName": internal} for title, internal in CHILD_SCHEMA.items()]
    client.overrides[endpoint] = {"value": schema, "odata.nextLink": next_endpoint}
    client.overrides[next_endpoint] = {"value": [{"Title": "ETAPA", "InternalName": "child_stage"}]}
    client.rows[CHILD][0]["ETAPA"] = "FUNDAÇÃO"

    assert client.get_pending_provision_descriptions()[0]["CHILDREN"][0]["ETAPA"] == "FUNDAÇÃO"


def test_encoded_sharepoint_next_link_preserves_complete_child_query():
    client = SyntheticRest()
    endpoint = client._list_endpoint(CHILD) + "/items"
    next_endpoint = client.site_url + "/_api/" + quote(endpoint, safe="/()'") + "?$skiptoken=second"
    client.overrides[endpoint] = {"value": client.encoded(CHILD, [child()]), "odata.nextLink": next_endpoint}
    client.overrides[next_endpoint] = {"value": client.encoded(CHILD, [child(2)])}
    group = client.get_pending_provision_descriptions()[0]
    assert group["PENDING CHILD IDS"] == ["1", "2"]
    assert group["VALOR TOTAL DESCRITIVO"] == "53"


def test_sharepoint_next_link_can_address_same_list_by_guid():
    client = SyntheticRest()
    endpoint = client._list_endpoint(CHILD) + "/items"
    next_endpoint = client.site_url + "/_api/Web/Lists(guid'00000000-0000-0000-0000-000000000042')/Items?$skiptoken=second"
    client.overrides[endpoint] = {"value": client.encoded(CHILD, [child()]), "odata.nextLink": next_endpoint}
    client.overrides[next_endpoint] = {"value": client.encoded(CHILD, [child(2)])}
    group = client.get_pending_provision_descriptions()[0]
    assert group["PENDING CHILD IDS"] == ["1", "2"]
    assert group["VALOR TOTAL DESCRITIVO"] == "53"


def test_pagination_rejects_similar_hostname_before_sending_credentials():
    client = SyntheticRest()
    endpoint = client._list_endpoint(CHILD) + "/items"
    next_endpoint = "https://example.sharepoint.com.evil.test/sites/test/_api/" + endpoint
    client.overrides[endpoint] = {"value": client.encoded(CHILD, [child()]), "odata.nextLink": next_endpoint}
    with pytest.raises(ValueError):
        client.get_pending_provision_descriptions()
    assert all(url != next_endpoint for url, _ in client.calls)


@pytest.mark.parametrize("list_title", [PARENT, CHILD])
def test_pagination_cycle_fails_instead_of_returning_partial_groups(list_title):
    client = SyntheticRest()
    endpoint = client._list_endpoint(list_title) + "/items"
    client.overrides[endpoint] = {"value": client.encoded(list_title, client.rows[list_title]),
                                  "odata.nextLink": endpoint}
    with pytest.raises(RuntimeError, match="(?i)cycl|cicl"):
        client.get_pending_provision_descriptions()


def test_page_limit_fails_instead_of_succeeding_with_truncated_children():
    client = SyntheticRest()
    endpoint = client._list_endpoint(CHILD) + "/items"
    client.overrides[endpoint] = {"value": client.encoded(CHILD, [child()]), "odata.nextLink": endpoint + "?page=2"}
    client.overrides[endpoint + "?page=2"] = {"value": client.encoded(CHILD, [child(2)])}
    with pytest.raises(RuntimeError, match="(?i)limit|limite"):
        query(client, max_pages=1).get_pending_provision_descriptions()


def test_record_limit_fails_even_when_last_page_has_no_next_link():
    client = SyntheticRest(children=[child(), child(2)])
    with pytest.raises(RuntimeError, match="(?i)limit|limite"):
        query(client, max_items=1).get_pending_provision_descriptions()


@pytest.mark.parametrize("payload", [{}, {"value": None}, {"value": {}}, {"d": {}}, {"value": [None]},
                                     {"value": [], "odata.nextLink": 123},
                                     {"d": {"results": [], "error": {"message": "Synthetic failure"}}}])
def test_malformed_rest_payload_cannot_become_empty_success(payload):
    client = SyntheticRest()
    client.overrides[client._list_endpoint(CHILD) + "/items"] = payload
    with pytest.raises((ValueError, RuntimeError)):
        client.get_pending_provision_descriptions()


def test_later_page_failure_propagates_without_empty_or_partial_success():
    client = SyntheticRest()
    endpoint = client._list_endpoint(CHILD) + "/items"
    client.overrides[endpoint] = {"value": client.encoded(CHILD, [child()]), "odata.nextLink": endpoint + "?page=2"}
    client.overrides[endpoint + "?page=2"] = requests.HTTPError("Synthetic unavailable page")
    with pytest.raises(requests.HTTPError, match="unavailable"):
        client.get_pending_provision_descriptions()


@pytest.mark.parametrize("list_title", [PARENT, CHILD])
def test_duplicate_item_on_paginated_read_is_rejected(list_title):
    client = SyntheticRest()
    endpoint = client._list_endpoint(list_title) + "/items"
    client.overrides[endpoint] = {"value": client.encoded(list_title, client.rows[list_title] * 2)}
    with pytest.raises(ValueError, match="(?i)duplicate|duplicad"):
        client.get_pending_provision_descriptions()


@pytest.mark.parametrize("field,raw", [
    ("QTD", None), ("QTD", ""), ("QTD", "unknown"), ("QTD", "0"), ("QTD", True),
    ("VALOR TOTAL", None), ("VALOR TOTAL", ""), ("VALOR TOTAL", "NaN"),
    ("VALOR TOTAL", "-1"), ("FRETE", "unknown"), ("FRETE", "Infinity"),
])
def test_invalid_amount_blocks_pending_group_but_strict_lookup_rejects_even_paid_child(field, raw):
    paid = child(2, **{"STATUS": "PAGO", field: raw})
    client = SyntheticRest(children=[child(), paid])
    group = client.get_pending_provision_descriptions()[0]
    assert group["VALOR TOTAL DESCRITIVO"] is None
    assert group["totalDisplay"] == "—"
    assert group["settlementBlocked"] is True
    assert field in group["amountError"]
    assert group["sourceKind"] == "provision-description"
    assert group["PENDING CHILD IDS"] == ["1"]
    assert group["CHILDREN"] == [child(), paid]
    with pytest.raises(ValueError, match="Invalid provision number"):
        client.get_provision_description(42)


def test_pending_reader_keeps_valid_and_invalid_whole_groups_in_due_order():
    parents = [parent(42, DATAPREVISTOPGTO="2026-10-11"), parent(2)]
    invalid = child(10, "42", **{"VALOR TOTAL": None})
    children = [invalid, child(9, "42", STATUS="PAGO"), child(3, "2"), child(1, "42")]
    client = SyntheticRest(parents, children)
    groups = client.get_pending_provision_descriptions()
    assert [row["Id"] for row in groups] == [42, 2]
    blocked, valid = groups
    assert blocked["settlementBlocked"] is True
    assert blocked["VALOR TOTAL DESCRITIVO"] is None
    assert blocked["totalDisplay"] == "—"
    assert blocked["CHILDREN"] == [child(1, "42"), child(9, "42", STATUS="PAGO"), invalid]
    assert blocked["PENDING CHILD IDS"] == ["1", "10"]
    assert blocked["OBS"] == parents[0]["OBS"]
    assert "VALOR TOTAL" in blocked["amountError"]
    assert valid["VALOR TOTAL DESCRITIVO"] == "26.5"
    assert valid["totalDisplay"] == "R$ 26,50"
    assert not valid.get("settlementBlocked", False)


def test_blocked_amount_message_lists_invalid_fields_without_private_values():
    client = SyntheticRest(children=[child(QTD="private-bad-value"),
                                     child(2, **{"VALOR TOTAL": "private-bad-unit"})])
    message = client.get_pending_provision_descriptions()[0]["amountError"]
    assert "QTD" in message and "VALOR TOTAL" in message
    assert "private-bad" not in message


def test_all_paid_invalid_group_is_excluded_from_pending_but_lookup_stays_strict():
    client = SyntheticRest(children=[child(STATUS="PAGO", **{"VALOR TOTAL": None})])
    assert client.get_pending_provision_descriptions() == []
    with pytest.raises(ValueError, match="Invalid provision number"):
        client.get_provision_description(42)


def test_pending_reader_does_not_swallow_unknown_calculation_errors(monkeypatch):
    module = importlib.import_module("provision_description_query")
    def fail(_fields):
        raise ValueError("Unexpected calculation failure")
    monkeypatch.setattr(module, "provision_line_total", fail)
    with pytest.raises(ValueError, match="Unexpected calculation failure"):
        SyntheticRest().get_pending_provision_descriptions()


def test_pending_reader_does_not_swallow_aggregate_errors(monkeypatch):
    module = importlib.import_module("provision_description_query")
    def fail(_totals):
        raise ValueError("Invalid provision number: QTD")
    monkeypatch.setattr(module, "_sum", fail)
    with pytest.raises(ValueError, match="Invalid provision number"):
        SyntheticRest().get_pending_provision_descriptions()


def test_invalid_amount_on_first_page_does_not_hide_later_transport_failure():
    client = SyntheticRest()
    endpoint = client._list_endpoint(CHILD) + "/items"
    client.overrides[endpoint] = {
        "value": client.encoded(CHILD, [child(**{"VALOR TOTAL": None})]),
        "odata.nextLink": endpoint + "?page=2",
    }
    client.overrides[endpoint + "?page=2"] = requests.HTTPError("Synthetic later page failure")
    with pytest.raises(requests.HTTPError, match="later page failure"):
        client.get_pending_provision_descriptions()


def test_parent_generic_etag_get_resolves_canonical_payment_dates_against_live_schema():
    client = SyntheticRest(parents=[parent(DATAPGTOEFETUADO="2026-10-10T03:00:00Z")])
    client.schemas[PARENT] = {field: field for field in PARENT_SCHEMA}
    # Live parent labels: due date has spaces, effective payment date does not.
    client.schemas[PARENT]["DATA PREVISTO PGTO"] = client.schemas[PARENT].pop("DATAPREVISTOPGTO")
    client.rows[PARENT][0]["DATA PREVISTO PGTO"] = client.rows[PARENT][0].pop("DATAPREVISTOPGTO")
    fields = ["FORNECEDOR", "FILIAL", "OBS", "FORMAPGTO", "PGTOAGENDADO",
              "DATA PREVISTO PGTO", "DATA PGTO EFETUADO", "VALORTOTAL"]
    assert client._internal_field(PARENT, "DATA PREVISTO PGTO") == "DATAPREVISTOPGTO"
    assert client._internal_field(PARENT, "DATA PGTO EFETUADO") == "DATAPGTOEFETUADO"
    result, etag = client.get_item_fields_with_etag(42, fields, target_list=PARENT)
    assert result["DATA PREVISTO PGTO"] == "2026-10-12T03:00:00Z"
    assert result["DATA PGTO EFETUADO"] == "2026-10-10T03:00:00Z"
    assert result["VALORTOTAL"] == "999"
    assert etag == '"synthetic-version"'
    selected = client.calls[-1][1]["$select"].split(",")
    assert "DATAPGTOEFETUADO" in selected and "DATAPREVISTOPGTO" in selected


def test_parent_date_alias_is_schema_guarded_and_does_not_affect_child_mapping():
    client = SyntheticRest()
    assert client._internal_field(PARENT, "DATA PGTO EFETUADO") == "DATA PGTO EFETUADO"
    assert client._internal_field(CHILD, "DATA PGTO EFETUADO") == "child_paid_date"


@pytest.mark.parametrize("freight", [None, "", "  "])
def test_blank_freight_is_zero_without_changing_child_snapshot(freight):
    client = SyntheticRest(children=[child(FRETE=freight)])
    group = client.get_pending_provision_descriptions()[0]
    assert group["VALOR TOTAL DESCRITIVO"] == "25.25"
    assert group["CHILDREN"][0]["FRETE"] == freight


def test_exact_decimal_sum_is_not_limited_by_default_context_or_rounded_per_child():
    children = [child(QTD="1", **{"VALOR TOTAL": "12345678901234567890123456789.123456789", "FRETE": "0"}),
                child(2, QTD=Decimal("1"), **{"VALOR TOTAL": "0.005", "FRETE": "0"}),
                child(3, QTD="1", **{"VALOR TOTAL": "0.005", "FRETE": "0"})]
    group = SyntheticRest(children=children).get_pending_provision_descriptions()[0]
    assert group["VALOR TOTAL DESCRITIVO"] == "12345678901234567890123456789.133456789"
    assert group["totalDisplay"] == "R$ 12.345.678.901.234.567.890.123.456.789,13"


def test_brazilian_amounts_and_valid_zero_unit_price():
    group = SyntheticRest(children=[child(QTD="1,5", **{"VALOR TOTAL": "R$ 1.234,50", "FRETE": "2,25"}),
                                    child(2, QTD="1", **{"VALOR TOTAL": "0", "FRETE": None})]).get_pending_provision_descriptions()[0]
    assert group["VALOR TOTAL DESCRITIVO"] == "1854"
    assert group["totalDisplay"] == "R$ 1.854,00"


def test_missing_amount_column_in_schema_fails_before_requesting_unsupported_items():
    client = SyntheticRest()
    del client.schemas[CHILD]["QTD"]
    with pytest.raises(ValueError, match="QTD"):
        client.get_pending_provision_descriptions()


def test_lookup_returns_all_paid_children_and_uses_parent_id_namespace():
    children = [child(42, "142"), child(2, "42", STATUS="PAGO", PGTOAGENDADO="PAGO")]
    client = SyntheticRest(parents=[parent(42, PGTOAGENDADO="PAGO"), parent(142)], children=children)
    group = client.get_provision_description("42")
    assert group["Id"] == 42
    assert [row["Id"] for row in group["CHILDREN"]] == [2]
    assert group["PENDING CHILD IDS"] == []
    assert group["VALOR TOTAL DESCRITIVO"] == "26.5"


def test_lookup_reloads_children_for_each_retry_and_reads_every_page():
    client = SyntheticRest()
    assert client.get_provision_description(42)["PENDING CHILD IDS"] == ["1"]
    client.rows[CHILD][0]["PGTOAGENDADO"] = "PAGO"
    assert client.get_provision_description(42)["PENDING CHILD IDS"] == []
    endpoint = client._list_endpoint(CHILD) + "/items"
    client.overrides[endpoint] = {"value": client.encoded(CHILD, client.rows[CHILD]), "odata.nextLink": endpoint + "?page=2"}
    client.overrides[endpoint + "?page=2"] = {"value": client.encoded(CHILD, [child(2)])}
    group = client.get_provision_description(42)
    assert group["PENDING CHILD IDS"] == ["2"]
    assert group["VALOR TOTAL DESCRITIVO"] == "53"


def test_unknown_parent_lookup_raises_even_if_child_id_collides():
    client = SyntheticRest(children=[child(99)])
    with pytest.raises(LookupError):
        client.get_provision_description("99")


@pytest.mark.parametrize("item_id", [None, "", "42 suffix", "42.0", "0042", 0, -1, True, 42.5])
def test_lookup_rejects_ambiguous_parent_ids_without_rest_request(item_id):
    client = SyntheticRest()
    with pytest.raises(ValueError):
        client.get_provision_description(item_id)
    assert client.calls == []


def test_existing_parent_without_children_has_no_known_total():
    with pytest.raises(ValueError, match="(?i)child|filh"):
        SyntheticRest(children=[]).get_provision_description(42)


def test_empty_collections_are_valid_pending_read():
    assert SyntheticRest(parents=[], children=[]).get_pending_provision_descriptions() == []
