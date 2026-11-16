"""Reconcile the salary-family credit used by a transmitted monthly DCTFWeb."""
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import hashlib
import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET


DCTF_NAMESPACE = "http://www.serpro.gov.br/dctf/v1"
NS = {"d": DCTF_NAMESPACE}
MAX_XML_BYTES = 4 * 1024 * 1024


class Review(ValueError):
    """The data does not establish a safe, exact reconciliation."""


class Pending(Exception):
    """The document or the complete provision does not exist yet."""


@dataclass(frozen=True)
class Debt:
    gross: int
    net: int
    family: int
    total_credits: int


@dataclass(frozen=True)
class Declaration:
    competence: str
    receipt: str
    transmitted: str
    digest: str
    debts: dict[str, Debt]


@dataclass(frozen=True)
class Adjustment:
    worker: dict
    gross: int
    net: int
    credit: int
    receipt: str
    transmitted: str
    digest: str


def _xml(data):
    if not isinstance(data, bytes) or not 1 <= len(data) <= MAX_XML_BYTES:
        raise Review("tamanho inválido para XML da DCTFWeb")
    try:
        decoded = data.decode("utf-8-sig")
        if re.search(r"<!\s*(DOCTYPE|ENTITY)\b", decoded, re.IGNORECASE):
            raise Review("XML contém uma declaração de entidade ou de tipo de documento")
        return ET.fromstring(decoded)
    except (UnicodeError, ET.ParseError) as exc:
        raise Review("XML inválido") from exc


def _one(node, path, required=True):
    matches = node.findall(path, NS)
    if len(matches) > 1 or required and not matches:
        raise Review(f"campo obrigatório ou ambíguo no XML: {path}")
    return matches[0] if matches else None


def _text(node, path, required=True):
    item = _one(node, path, required)
    if item is None:
        return None
    result = (item.text or "").strip()
    if list(item) or not result:
        raise Review(f"campo inválido no XML: {path}")
    return result


def _competence(value):
    match = re.fullmatch(r"(20[0-9]{2})-?(0[1-9]|1[0-2])(?:[0-9]{2})?", value)
    if not match:
        raise Review("período de apuração da DCTFWeb inválido")
    return "-".join(match.groups())


def _money(node, path, required=True):
    value = _text(node, path, required)
    if value is None:
        return 0
    if not re.fullmatch(r"[0-9]{1,16}(?:\.[0-9]{1,2})?", value):
        raise Review(f"valor inválido no XML: {path}")
    return int(Decimal(value) * 100)


def _parse(root, data, cnpj, competence):
    if root.tag != f"{{{DCTF_NAMESPACE}}}ProcDctf":
        raise Review("arquivo não é o XML de Saída de uma DCTFWeb transmitida")
    declaration = _one(root, "d:ConteudoDeclaracao/d:DctfXml")
    identity = _one(declaration, "d:A000-DadosIdentificadoresContribuinte")
    if _text(identity, "d:inscContrib") != cnpj:
        raise Review("CNPJ do XML difere do contribuinte configurado")
    if _text(identity, "d:categoriaDCTF") != "40":
        raise Review("declaração não pertence à categoria geral mensal")
    if _competence(_text(identity, "d:perApuracao")) != competence:
        raise Review("competência do XML difere do descritivo de INSS")
    information = _one(root, "d:OutrasInformacoes")
    receipt = _text(information, "d:numeroRecibo")
    transmitted = _text(information, "d:dataHoraTransmissao")
    try:
        if not re.fullmatch(r"[0-9]{14}", transmitted) or not re.fullmatch(r"[0-9]{1,19}", receipt) or not int(receipt):
            raise ValueError
        transmission_date = datetime.strptime(transmitted, "%Y%m%d%H%M%S")
        if transmission_date.strftime("%Y-%m") < competence:
            raise ValueError
    except ValueError as exc:
        raise Review("recibo ou data de transmissão inválidos") from exc

    if _one(identity, "d:A051-SituacoesEspeciais", required=False) is not None:
        raise Review("declaração com situação especial exige conciliação específica")
    container = _one(identity, "d:A050-CreditosTributariosApurados")
    debts = {}
    for line in container.findall("d:CreditoTributarioApurado", NS):
        code = _text(line, "d:codReceita")
        if not re.fullmatch(r"[0-9]{1,6}", code):
            raise Review("código de receita inválido")
        code = code.zfill(6)
        line_month = _text(line, "d:paDebito", required=False)
        if line_month and _competence(line_month) != competence:
            if code == "108201":
                raise Review("código 1082 de competência anterior no XML")
            continue
        debt = Debt(
            gross=_money(line, "d:ctValor"), net=_money(line, "d:saldoaPagar"),
            family=_money(line, "d:A250-DeducaoSalFamiliaValoresVinculados/d:dedSalFamilia", required=False),
            total_credits=_money(line, "d:vlTotalCred"),
        )
        prior = debts.get(code, Debt(0, 0, 0, 0))
        debts[code] = Debt(
            prior.gross + debt.gross, prior.net + debt.net, prior.family + debt.family,
            prior.total_credits + debt.total_credits,
        )
    if not debts:
        raise Review("XML transmitido sem débitos apurados")
    return Declaration(competence, receipt, transmitted, hashlib.sha256(data).hexdigest(), debts)


def read_declaration(data, cnpj, competence):
    return _parse(_xml(data), data, cnpj, competence)


def select_declaration(inputs, cnpj, competence, preferred_digest=None):
    declarations = []
    for data in inputs:
        root = _xml(data)
        if root.tag == f"{{{DCTF_NAMESPACE}}}ProcDctf":
            declarations.append(_parse(root, data, cnpj, competence))
    if preferred_digest:
        preferred = next((item for item in declarations if item.digest == preferred_digest), None)
        if preferred is None:
            raise Pending("aguardando XML do recibo que está em conciliação")
        return preferred
    if not declarations:
        raise Pending("aguardando XML de Saída da DCTFWeb")
    latest = max(item.transmitted for item in declarations)
    choices = {item.digest: item for item in declarations if item.transmitted == latest}
    if len(choices) != 1:
        raise Review("existem arquivos conflitantes para a última transmissão da DCTFWeb")
    return next(iter(choices.values()))


def plan_reconciliation(manifest, declaration):
    if manifest.get("competence") != declaration.competence or manifest.get("key") != f"ENCARGOS:{declaration.competence}":
        raise Review("manifesto e declaração devem pertencer à mesma competência")
    rows = manifest["rows"]
    flagged = [row for row in rows if row.get("salaryFamilyReview") is True]
    if len(flagged) != 1:
        raise Review("o crédito coletivo precisa de um único vínculo sinalizado no manifesto")
    expected = Counter()
    for row in rows:
        components = row["components"]
        if not components or any(type(v) is not int or v < 0 for v in components.values()):
            raise Review("valores de contribuição inválidos no manifesto")
        if sum(components.values()) != row["inssCents"]:
            raise Review("componentes individuais do manifesto não fecham")
        estimate = row.get("salaryFamilyEstimatedCents", 0)
        if (type(estimate) is not int or not 0 <= estimate <= row["inssCents"]
                or (estimate and row is not flagged[0])):
            raise Review("previsão de salário-família inválida no manifesto")
        expected.update({"108201" if k == "EMPREGADO" else k+"01": v for k,v in components.items()})
    gross = sum(expected.values())
    if gross != manifest["totals"]["INSS"] or expected.get("108201", 0) <= 0:
        raise Review("total bruto do manifesto não fecha")
    forecast_net = gross - flagged[0].get("salaryFamilyEstimatedCents", 0)
    if manifest["totals"].get("INSSNet", gross) != forecast_net:
        raise Review("total líquido previsto do manifesto não fecha")
    if any(item.family for code, item in declaration.debts.items() if code != "108201"):
        raise Review("o salário-família está vinculado também a outro código de receita")
    prefixes = {code[:4] for code in expected}
    if any(code[:4] in prefixes and code not in expected
           for code in declaration.debts):
        raise Review("declaração tem outro código de extensão da folha")
    net = 0
    credit = 0
    for code, expected_gross in expected.items():
        item = declaration.debts.get(code, Debt(0, 0, 0, 0))
        if item.gross != expected_gross:
            raise Review(f"valor bruto do código {code} diverge do manifesto")
        if item.gross - item.net != item.family or item.total_credits != item.family:
            raise Review(f"código {code} tem ajuste além de salário-família")
        net += item.net
        credit += item.family
    if credit > flagged[0]["inssCents"] or gross - credit != net:
        raise Review("crédito acima do valor da provisão do vínculo sinalizado")
    return Adjustment(flagged[0], gross, net, credit, declaration.receipt, declaration.transmitted, declaration.digest)


def _save(state, record):
    state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode="w", dir=state.parent, encoding="utf-8", delete=False) as file:
        temp = file.name
        try:
            json.dump(record, file)
            file.flush()
            os.fsync(file.fileno())
            file.close()
            os.replace(temp, state)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)


def _token(adjustment):
    return {key: getattr(adjustment, key) for key in ("receipt", "transmitted", "digest", "credit", "gross", "net")}


def reconcile(ledger, manifest, declaration, state, dry_run=False):
    """Apply exact targets and resume partial SharePoint writes from a durable intent."""
    adjustment = plan_reconciliation(manifest, declaration)
    record = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
    previous = record.get("completed") or {}
    pending = record.get("pending")
    if previous.get("transmitted", "") > adjustment.transmitted:
        return "ORIGEM_SUPERADA"
    if previous.get("transmitted") == adjustment.transmitted:
        if previous != _token(adjustment):
            raise Review("última transmissão já processada com identificação ou conteúdo diferente")
        return "CONCILIADO"
    if pending:
        if pending != _token(adjustment):
            raise Review("conciliação em andamento para outro recibo; preserve e reapresente o XML original")
    previous_credit = previous.get("credit", adjustment.worker.get("salaryFamilyEstimatedCents", 0))
    old_receipt = previous.get("receipt")
    ledger.preflight(manifest, adjustment, previous_credit, old_receipt, pending=bool(pending))
    if dry_run:
        return "PREVIA_CONFERIDA"
    _save(state, {"completed": previous, "pending": _token(adjustment)})
    ledger.apply(manifest, adjustment, previous_credit, old_receipt)
    ledger.verify(manifest, adjustment)
    _save(state, {"completed": _token(adjustment)})
    return "CONCILIADO"
