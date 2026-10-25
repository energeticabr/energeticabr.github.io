"""Salary-only provision model. No credentials, I/O, tax-regime defaults or writes."""
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
import re
import unicodedata


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '')).upper()
                   if c.isascii() and c.isalnum())


def positive_id(value):
    if isinstance(value, bool) or not re.fullmatch(r'[1-9][0-9]{0,14}', str(value)):
        raise ValueError('Identificador ausente ou inválido.')
    return int(value)


def day(value):
    try:
        text = str(value or '')[:10]
        result = date.fromisoformat(text)
        if result.isoformat() != text: raise ValueError()
        return result
    except (ValueError, TypeError):
        raise ValueError('Data ausente ou inválida.') from None


def month(value):
    text = str(value or '').strip()
    br = re.fullmatch(r'(\d{1,2})/(\d{4})', text)
    if br: text = f'{br[2]}-{int(br[1]):02d}'
    if not re.fullmatch(r'\d{4}-\d{2}', text) or not 1 <= int(text[5:]) <= 12:
        raise ValueError('Competência inválida.')
    return text


def money_cents(value):
    try:
        text = str(value).strip()
        if ',' in text: text = text.replace('.', '').replace(',', '.')
        amount = Decimal(text)
        if not amount.is_finite() or amount < 0 or amount * 100 != (amount * 100).to_integral_value():
            raise ValueError()
        cents = int(amount * 100)
        if cents > 10**12: raise ValueError()
        return cents
    except (InvalidOperation, ValueError):
        raise ValueError('Valor de salário inválido.') from None


def money(cents):
    return f'{Decimal(cents) / 100:.2f}'


def validate_rules(rules, competence):
    if not isinstance(rules, dict) or rules.get('confirmed') is not True or rules.get('base') != 'SALARIO':
        raise ValueError('Regras financeiras precisam estar confirmadas para SALARIO.')
    if not str(rules.get('version') or '').strip(): raise ValueError('Versão das regras ausente.')
    if not month(rules.get('validFrom')) <= competence <= month(rules.get('validThrough')):
        raise ValueError('Regras financeiras fora de vigência na competência.')
    if rules.get('divisor') not in (30, 'calendar') or isinstance(rules.get('divisor'), bool):
        raise ValueError('Divisor da proporcionalidade não confirmado.')
    if rules.get('employeeRounding') not in ('truncate', 'half_up') or rules.get('employerRounding') not in ('truncate', 'half_up'):
        raise ValueError('Arredondamento não definido.')
    def rate(value):
        if type(value) is not int or not 0 <= value <= 10000: raise ValueError('Alíquota inválida.')
    rate(rules.get('fgtsBps'))
    if not rules['fgtsBps']: raise ValueError('FGTS sem alíquota confirmada.')
    previous = 0
    if not isinstance(rules.get('employeeBrackets'), list) or not rules['employeeBrackets']:
        raise ValueError('Tabela progressiva ausente.')
    for band in rules['employeeBrackets']:
        limit = band.get('limitCents')
        if type(limit) is not int or not previous < limit <= 10**10: raise ValueError('Faixas inválidas.')
        rate(band.get('rateBps')); previous = limit
    if not isinstance(rules.get('employerComponents'), list) or not rules['employerComponents']:
        raise ValueError('Contribuições patronais não confirmadas.')
    codes = set()
    for component in rules['employerComponents']:
        code = str(component.get('code') or '')
        if not re.fullmatch(r'[A-Z0-9-]{1,40}', code) or code in codes or code == 'EMPREGADO':
            raise ValueError('Componente patronal inválido ou duplicado.')
        if not str(component.get('label') or '').strip(): raise ValueError('Descrição patronal ausente.')
        codes.add(code); rate(component.get('rateBps'))


def tax_cents(base_cents, basis_points, rounding='truncate'):
    return int((Decimal(base_cents) * basis_points / 10000).to_integral_value(
        rounding=ROUND_DOWN if rounding == 'truncate' else ROUND_HALF_UP))


def plan_month(employees, suppliers, salaries, sheets, rules, execution_date):
    execution_date = day(execution_date)
    end = execution_date.replace(day=1) - timedelta(days=1)
    start = end.replace(day=1)
    competence = start.isoformat()[:7]
    validate_rules(rules, competence)
    rows, seen_ids, seen_names = [], set(), set()
    for employee in employees:
        if normalized(employee.get('STATUS')) != 'ATIVO' or normalized(employee.get('EMPREITEIRO')) != 'SIM': continue
        if str(employee.get('DATADESLIGAMENTO') or '').strip(): continue
        admission = day(employee.get('DATAADMISSAO'))
        if admission > end: continue
        if normalized(employee.get('VINCULO')) != 'CLT':
            raise ValueError('Vínculo CLT não confirmado; regime não coberto pelas regras.')
        sid = positive_id(employee.get('IDFORNECEDORORIGEM'))
        sources = [source for source in suppliers if str(source.get('Id')) == str(sid)]
        if sid in seen_ids or len(sources) != 1: raise ValueError('Identidade de fornecedor ausente ou duplicada.')
        source = sources[0]
        name, branch, profession, cargo = [str(value or '').strip() for value in
            (source.get('Title'), source.get('FILIAL'), source.get('PROFISSAO'), employee.get('CARGO'))]
        if not all((name, branch, profession, cargo)) or normalized(name) in seen_names:
            raise ValueError('Nome, filial, profissão ou cargo ausente/duplicado.')
        if employee.get('Title') and normalized(employee['Title']) != normalized(name):
            raise ValueError('Identidade do cadastro RH diverge do fornecedor.')
        if normalized(source.get('STATUS')) != 'ATIVO' or normalized(source.get('EMPREITEIRO')) != 'SIM':
            raise ValueError('Fornecedor deixou de ser empreiteiro ativo.')
        seen_ids.add(sid); seen_names.add(normalized(name))
        matches = [sheet for sheet in sheets if normalized(sheet.get('FORNECEDOR')) == normalized(name)
                   and month(sheet.get('MESREFERENCIA')) == competence]
        if len(matches) != 1: raise ValueError(f'ID da folha não é único para fornecedor {sid} e competência {competence}.')
        sheet_id = positive_id(matches[0].get('Id'))
        first_day = max(start, admission)
        applicable = [(day(salary.get('DATAREFERENCIA')), salary) for salary in salaries
                      if normalized(salary.get('CARGO')) == normalized(cargo)
                      and day(salary.get('DATAREFERENCIA')) <= end]
        if not applicable or any(effective > first_day for effective, _ in applicable):
            raise ValueError(f'Vigência de salário ausente/alterada durante a competência para {cargo}.')
        latest = max(effective for effective, _ in applicable)
        current = [salary for effective, salary in applicable if effective == latest]
        if len(current) != 1: raise ValueError(f'Salário vigente ambíguo para {cargo}.')
        salary_cents = money_cents(current[0].get('SALARIO'))
        if salary_cents <= 0: raise ValueError(f'Salário não informado para {cargo}.')
        divisor = 30 if rules['divisor'] == 30 else monthrange(start.year, start.month)[1]
        worked_days = divisor if admission <= start else min(divisor, (end - admission).days + 1)
        base = int((Decimal(salary_cents) * worked_days / divisor).to_integral_value(rounding=ROUND_HALF_UP))
        lower, employee_cents = 0, 0
        for band in rules['employeeBrackets']:
            width = max(0, min(base, band['limitCents']) - lower)
            employee_cents += tax_cents(width, band['rateBps'], rules['employeeRounding'])
            lower = band['limitCents']
        components = {'EMPREGADO': employee_cents}
        components.update({component['code']: tax_cents(base, component['rateBps'], rules['employerRounding'])
                           for component in rules['employerComponents']})
        rows.append(dict(supplierId=sid, name=name, branch=branch, profession=profession, cargo=cargo,
                         admission=admission.isoformat(), sheetId=sheet_id, salaryCents=salary_cents,
                         days=worked_days, divisor=divisor, baseCents=base, components=components,
                         inssCents=sum(components.values()), fgtsCents=tax_cents(base, rules['fgtsBps'])))
    rows.sort(key=lambda row: row['supplierId'])
    # Employer contributions are totalized per establishment/branch and revenue
    # code. Allocate ONLY the resulting cent remainders, not an aggregate guide
    # copied to each employee. Largest fractions first, supplier ID breaks ties.
    for branch in sorted({row['branch'] for row in rows}):
        group = [row for row in rows if row['branch'] == branch]
        for component in rules['employerComponents']:
            code, rate = component['code'], component['rateBps']
            for row in group: row['components'][code] = tax_cents(row['baseCents'], rate)
            target = tax_cents(sum(row['baseCents'] for row in group), rate, rules['employerRounding'])
            remaining = target - sum(row['components'][code] for row in group)
            priority = sorted(group, key=lambda row: (-(row['baseCents'] * rate % 10000), row['supplierId']))
            for row in priority[:remaining]: row['components'][code] += 1
    for row in rows: row['inssCents'] = sum(row['components'].values())
    return dict(version=1, competence=competence, createdDate=execution_date.isoformat(),
                dueDate=execution_date.replace(day=20).isoformat(), rulesVersion=rules['version'],
                rules=rules, rows=rows, totals={'INSS': sum(row['inssCents'] for row in rows),
                                              'FGTS': sum(row['fgtsCents'] for row in rows)})


def parent_fields(plan, tax):
    if tax not in ('INSS', 'FGTS') or not plan['rows']: raise ValueError('Tipo ou lote vazio.')
    branches = {row['branch'] for row in plan['rows']}
    key = f'ENCARGOS:{plan["competence"]}:{tax}'
    return dict(Title=key, FOLHAOPERACAO=key, FILIAL=next(iter(branches)) if len(branches) == 1 else 'DIVERSAS',
                FORNECEDOR=plan['rows'][0]['name'] if len(plan['rows']) == 1 else 'DIVERSOS',
                VALORTOTAL=money(plan['totals'][tax]), OBS=f'{tax} - COMPETÊNCIA {plan["competence"]}',
                FORMAPGTO='', STATUS='PAGAMENTO PREVISTO', DATAPREVISTOPGTO=plan['dueDate']+'T12:00:00Z')


def provision_fields(plan, row, tax, parent_id):
    key = f'ENCARGOS:{plan["competence"]}:{tax}:{row["supplierId"]}'
    amount = row['inssCents'] if tax == 'INSS' else row['fgtsCents']
    return dict(Title=key, FOLHAOPERACAO=key, FILIAL=row['branch'], FORNECEDOR=row['name'],
                PRODUTO=row['profession'], OBS=f'{tax} - {row["name"]} - COMPETÊNCIA {plan["competence"]}',
                IMOVEL='TODOS', FORMAPGTO='', QTD='1', VALORTOTAL=money(amount), FRETE='0',
                STATUS='PAGAMENTO PREVISTO', PGTOAGENDADO='PENDENTE', DATA=plan['createdDate']+'T12:00:00Z',
                DATAPREVISTOPGTO=plan['dueDate']+'T12:00:00Z', DESCRITIVOPROVISAO=str(positive_id(parent_id)),
                IDFOLHA=positive_id(row['sheetId']))


def payroll_fields(plan, row, tax, provision_id):
    return dict(Title=f'APP-folha-provisao-{positive_id(provision_id)}', FORNECEDOR=row['name'], TIPOPGTO=tax,
                VALORUNITARIO=money(row['inssCents'] if tax == 'INSS' else row['fgtsCents']), QTD='1',
                DATA=plan['dueDate']+'T12:00:00Z', IDFOLHA=str(positive_id(row['sheetId'])),
                IDPROVISAO=positive_id(provision_id))
