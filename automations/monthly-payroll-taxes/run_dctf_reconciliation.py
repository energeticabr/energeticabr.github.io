"""Reconcile the monthly INSS provision when its DCTFWeb export is attached."""

import argparse
from contextlib import nullcontext
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

from dctf_reconciliation import Pending, Review, reconcile, select_declaration


PARENT = "DESCRITIVOPROVISAO"
CHILD = "PROVISÃO PGTOS"
PAYROLL = "FOLHAPGTO"
MAX_INPUT = 4 * 1024 * 1024
STATE_HOME = "/var/lib/energetica-whatsapp/inss-dctfweb"
MIN_COMPETENCE = "2026-11"
COMPETENCE_CODE = re.compile(r"ENCARGOS:(\d{4}-(?:0[1-9]|1[0-2])):INSS")
OPEN = {"", "PENDENTE", "PAGAMENTO PREVISTO"}
PAYMENT_LINKS = ("IDLANCAMENTO", "IDLANCAMENTOS", "IDPEDIDO", "IDPEDIDOS",
                 "DATAPGTOEFETUADO", "DATAPAGAMENTO", "DATAPGTO")
REVIEW_NOTICE = " | SALÁRIO-FAMÍLIA: conferir crédito da competência na DCTFWeb."
XML_NOTICE = " | SALÁRIO-FAMÍLIA: anexar XML de Saída da DCTFWeb para conciliação automática."


def present(value):
    return value is not None and str(value).strip() != ""


def number(value, scale=1):
    try:
        n = Decimal(str(value).strip().replace(",", ".")) * scale
        if n.is_finite() and n >= 0 and n == n.to_integral_value():
            return int(n)
    except (InvalidOperation, ValueError):
        pass
    raise Review("Número inválido em lançamento de INSS")


def money(cents):
    return f"{cents // 100}.{cents % 100:02d}"


def live_is_open(row):
    return (
        not any(present(row.get(key)) for key in PAYMENT_LINKS)
        and all(str(row.get(key) or "").strip().upper() in OPEN for key in ("STATUS", "PGTOAGENDADO"))
    )


class SharePoint:
    def __init__(self, client):
        self.client = client

    def items(self, path, predicate=None):
        params = {"$top": "500"}
        if predicate is not None:
            params["$filter"] = predicate
        result, seen = [], set()
        collection_url = urlsplit(self.client.site_url + "/_api/" + path)
        while path:
            if path in seen:
                raise Review("Paginação repetida no SharePoint")
            seen.add(path)
            data = self.client._request("GET", path, params=params)
            if not isinstance(data.get("value"), list):
                raise Review("Coleção de INSS não pôde ser confirmada")
            result.extend(data["value"])
            path = data.get("odata.nextLink") or data.get("@odata.nextLink")
            if path:
                next_url = urlsplit(path)
                if (next_url.scheme, next_url.netloc, next_url.path) != (
                    collection_url.scheme, collection_url.netloc, collection_url.path
                ):
                    raise Review("Paginação inesperada no SharePoint")
            params = None
        return result

    def collection(self, list_name, predicate):
        return self.items(self.client._list_endpoint(list_name) + "/items", predicate)

    def read(self, list_name, ident):
        endpoint = f"{self.client._list_endpoint(list_name)}/items({ident})"
        response = self.client._request("GET", endpoint, _return_response=True)
        tag = response.headers.get("ETag")
        if not tag or tag == "*":
            raise Review("Versão do lançamento não pôde ser confirmada")
        return response.json(), tag

    def bytes_at(self, endpoint):
        with self.client._request("GET", endpoint, _return_response=True, stream=True) as response:
            content = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                content.extend(chunk)
                if len(content) > MAX_INPUT:
                    raise Review("Arquivo fiscal acima de 4 MiB")
            return bytes(content)

    def declarations(self, parent):
        endpoint = f"{self.client._list_endpoint(PARENT)}/items({parent})/AttachmentFiles"
        for file in self.items(endpoint):
            name = file.get("FileName")
            if isinstance(name, str) and name.lower().endswith(".xml"):
                safe_name = quote(name.replace("'", "''"), safe="")
                yield self.bytes_at(f"{endpoint}/getByFileName('{safe_name}')/$value")

    def manifest(self, competence):
        root = urlsplit(self.client.site_url).path.rstrip("/") + "/Documents/"

        def endpoint(name):
            return f"web/GetFileByServerRelativeUrl('{root}{name}')"

        reservation = endpoint(f"ENCARGOS-RESERVA-{competence}.json")
        try:
            data = json.loads(self.bytes_at(reservation + "/$value"))
            name = data["manifestPath"]
            if data["key"] != f"ENCARGOS:{competence}" or not re.fullmatch(
                rf"/ENCARGOS-{re.escape(competence)}-[A-Za-z0-9]+\.json", name
            ):
                raise ValueError("reserva incompatível")
            tag = data["manifestETag"]
            if not isinstance(tag, str) or not tag.strip() or tag == "*":
                raise ValueError("reserva sem versão")
            path = endpoint(name[1:])
            if self.client._request("GET", path, params={"$select": "ETag"}).get("ETag") != tag:
                raise ValueError("versão do manifesto divergente")
            plan = json.loads(self.bytes_at(path + "/$value"))
            if self.client._request("GET", path, params={"$select": "ETag"}).get("ETag") != tag:
                raise ValueError("manifesto mudou durante a leitura")
            if (plan["competence"], plan["key"]) != (competence, data["key"]):
                raise ValueError("competência do manifesto divergente")
            return plan
        except (KeyError, TypeError, ValueError) as exc:
            raise Review("Reserva mensal ou manifesto inválido") from exc


class SharePointLedger:
    def __init__(self, sharepoint, parent_id):
        self.sp = sharepoint
        self.parent_id = parent_id

    def _rows(self, plan, adjustment, previous_credit, old_receipt,
              allow_target=False, allow_closed=False):
        competence = plan["competence"]
        key = f"ENCARGOS:{competence}:INSS"
        parent, parent_tag = self.sp.read(PARENT, self.parent_id)
        if (parent.get("Title"), parent.get("FOLHAOPERACAO")) != (key, key):
            raise Review("Descritivo não corresponde à competência")

        expected = {f"{key}:{item['supplierId']}": item for item in plan["rows"]}
        children = self.sp.collection(CHILD, f"DESCRITIVOPROVISAO eq '{self.parent_id}'")
        if (len(children) != len(expected) or len(expected) != len(plan["rows"])
            or {row.get("FOLHAOPERACAO") for row in children} != expected.keys()):
            raise Pending("O grupo de provisões de INSS diverge do manifesto mensal")

        child_ids = [number(row["Id"]) for row in children]
        links = {}
        for offset in range(0, len(child_ids), 20):
            predicate = " or ".join(f"IDPROVISAO eq {ident}" for ident in child_ids[offset:offset + 20])
            for link in self.sp.collection(PAYROLL, predicate):
                ident = number(link["IDPROVISAO"])
                if ident in links:
                    raise Review("Vínculo de folha duplicado")
                links[ident] = link
        if links.keys() != set(child_ids):
            raise Pending("A folha ainda não tem os vínculos do grupo completo")

        if not allow_closed and not all(map(live_is_open, (parent, *children, *links.values()))):
            raise Review("Existe pagamento ou agendamento no grupo de INSS")

        def accepted(gross, affected=True):
            if not affected:
                return {gross}
            allowed = {gross - previous_credit}
            if allow_target:
                allowed.add(gross - adjustment.credit)
            return allowed

        def check_amount(row, column, gross, affected=True):
            if number(row.get(column), 100) not in accepted(gross, affected):
                raise Review("Valor atual diverge da previsão e dos créditos conciliados")

        parent_base = f"INSS - COMPETÊNCIA {competence}"
        child_base = f"INSS - {adjustment.worker['name']} - COMPETÊNCIA {competence}"

        def check_note(row, base):
            if old_receipt:
                notes = {_note(base, old_receipt, previous_credit)}
            elif row is parent:
                notes = {base}
            else:
                notes = {base + REVIEW_NOTICE, base + XML_NOTICE}
            if allow_target:
                notes.add(_note(base, adjustment.receipt, adjustment.credit))
            if row.get("OBS") not in notes:
                raise Review("Observação alterada desde a geração do INSS")

        check_amount(parent, "VALORTOTAL", adjustment.gross)
        check_note(parent, parent_base)
        selected_key = f"{key}:{adjustment.worker['supplierId']}"
        selected = None
        for row in children:
            ident = number(row["Id"])
            original = expected[row["FOLHAOPERACAO"]]
            link = links[ident]
            if (row.get("Title") != row["FOLHAOPERACAO"]
                or link.get("Title") != f"APP-folha-provisao-{ident}"
                or link.get("TIPOPGTO") != "INSS"
                or row.get("FORNECEDOR") != original["name"]
                or link.get("FORNECEDOR") != original["name"]
                or number(row.get("DESCRITIVOPROVISAO")) != self.parent_id
                or number(row.get("IDFOLHA")) != original["sheetId"]
                or number(link.get("IDFOLHA")) != original["sheetId"]
                or number(row.get("QTD")) != 1 or number(link.get("QTD")) != 1):
                raise Review("Identidade, quantidade ou vínculo divergente na folha")
            affected = row["FOLHAOPERACAO"] == selected_key
            gross = original["inssCents"]
            check_amount(row, "VALORTOTAL", gross, affected)
            check_amount(link, "VALORUNITARIO", gross, affected)
            if affected:
                check_note(row, child_base)
                selected = row, link
        if selected is None:
            raise Review("Vínculo com salário-família não consta do grupo")
        child, link = selected
        return parent, parent_tag, child, link, parent_base, child_base

    def preflight(self, plan, adjustment, previous_credit, old_receipt, pending=False):
        self._rows(plan, adjustment, previous_credit, old_receipt, allow_target=pending)

    def apply(self, plan, adjustment, previous_credit, old_receipt):
        for target in (CHILD, PAYROLL, PARENT):
            parent, parent_tag, child, link, parent_base, child_base = self._rows(
                plan, adjustment, previous_credit, old_receipt, allow_target=True
            )
            if target == PARENT:
                item, etag = parent, parent_tag
                fields = {"VALORTOTAL": money(adjustment.net),
                          "OBS": _note(parent_base, adjustment.receipt, adjustment.credit)}
            else:
                item = child if target == CHILD else link
                fresh, etag = self.sp.read(target, number(item["Id"]))
                stable = all(fresh.get(key) == value for key, value in item.items()
                             if not key.startswith(("@", "odata.")))
                if not stable or not live_is_open(fresh):
                    raise Review("Folha ou provisão mudou durante a conciliação")
                item = fresh
                amount = money(adjustment.worker["inssCents"] - adjustment.credit)
                if target == CHILD:
                    fields = {"VALORTOTAL": amount, "OBS": _note(child_base, adjustment.receipt, adjustment.credit)}
                else:
                    fields = {"VALORUNITARIO": amount}
            changed = {
                k: v for k, v in fields.items()
                if (item.get(k) != v if k == "OBS" else number(item.get(k), 100) != number(v, 100))
            }
            if changed:
                self.sp.client.update_item_with_etag(number(item["Id"]), changed, etag, target_list=target)

    def verify(self, plan, adjustment):
        self._rows(plan, adjustment, adjustment.credit, adjustment.receipt, allow_closed=True)


def _note(base, receipt, credit):
    result = f"{base} | DCTFWeb {receipt}: salário-família R$ {money(credit).replace('.', ',')}."
    if len(result) > 255:
        raise Review("Observação não cabe no campo da provisão")
    return result


def make_client():
    sys.path[:0] = ["/opt/energetica-whatsapp", "/opt/energetica-whatsapp/worker"]
    from local_app import load_env
    from clients import SharePointClient

    load_env(Path("/etc/energetica-whatsapp.env"))
    return SharePointClient(os.environ["SHAREPOINT_HOST"], os.environ["SHAREPOINT_SITE_PATH"],
        os.environ["ENTRA_TENANT_ID"], os.environ["ENTRA_CLIENT_ID"],
        Path(os.environ["ENTRA_PRIVATE_KEY_FILE"]).read_text(),
        Path(os.environ["ENTRA_CERTIFICATE_FILE"]).read_text(), CHILD)


def run(sharepoint, cnpj, start, journal, now, dry_run):
    if now.day == 1:
        cutoff = (now.date() - timedelta(days=1)).strftime("%Y-%m")
    else:
        cutoff = now.strftime("%Y-%m")
    result = []
    parents = {}
    for row in sharepoint.collection(PARENT, "startswith(FOLHAOPERACAO,'ENCARGOS:')"):
        match = COMPETENCE_CODE.fullmatch(row.get("FOLHAOPERACAO") or "")
        if not match or not start <= match[1] < cutoff:
            continue
        competence = match[1]
        if competence in parents:
            raise Review("Descritivo mensal duplicado")
        parents[competence] = row
    for competence, row in sorted(parents.items()):
        if not live_is_open(row):
            continue
        ident = number(row["Id"])
        state = journal / f"{competence}.json"
        detail = {"competence": competence, "parent": ident}
        try:
            record = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
            pending = record.get("pending") or {}
            options = {"preferred_digest": pending["digest"]} if pending else {}
            declaration = select_declaration(sharepoint.declarations(ident), cnpj, competence, **options)
            if declaration is None:
                raise Pending("Aguardando XML de saída da DCTFWeb")
            manifest = sharepoint.manifest(competence)
            ledger = SharePointLedger(sharepoint, ident)
            detail["state"] = reconcile(ledger, manifest, declaration, state, dry_run=dry_run)
        except Pending as exc:
            detail.update(state="AGUARDANDO", message=str(exc))
        except Review as exc:
            detail.update(state="REVISAR", message=str(exc))
        except Exception as exc:
            detail.update(state="ERRO", error=type(exc).__name__)
        result.append(detail)
    return result


def main():
    import fcntl

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--state-dir", type=Path, default=Path(STATE_HOME))
    parser.add_argument("--cnpj", default=os.getenv("ENERGETICA_DCTFWEB_CNPJ", ""))
    parser.add_argument("--from-competence", default=os.getenv("ENERGETICA_DCTFWEB_FROM", MIN_COMPETENCE))
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]{14}", args.cnpj):
        parser.error("Informe o CNPJ da empresa em ENERGETICA_DCTFWEB_CNPJ")
    if not re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", args.from_competence) or args.from_competence < MIN_COMPETENCE:
        parser.error("A primeira competência permitida é novembro de 2026")
    lock_path = args.state_dir / "worker.lock"
    if not args.dry_run:
        args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (lock_path.open("a") if args.state_dir.is_dir() else nullcontext()) as lock:
        if lock is not None:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run(SharePoint(make_client()), args.cnpj, args.from_competence, args.state_dir,
                     datetime.now(ZoneInfo("America/Sao_Paulo")), args.dry_run)
    print(json.dumps({"dryRun": args.dry_run, "results": result}, ensure_ascii=False))
    return 2 if any(row["state"] == "ERRO" for row in result) else 0


if __name__ == "__main__":
    sys.exit(main())
