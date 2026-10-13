"""Read-only RHID directory and daily punches for presence-selection badges.

Uses the same login and AFD 671 endpoint as the existing collector. It never
resynchronizes the device or writes to RHID/SharePoint. Only name, person ID and
daily times leave this module; credentials, PIS and biometric fields do not.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
import json
from pathlib import Path
import re
import threading
import time

import requests

API = 'https://www.rhid.com.br/v2/api.svc'
CONFIG = Path('/etc/energetica-rhid-directory.json')
ERROR = 'A consulta RHID está indisponível. Tente novamente.'

class RhidBadgeUnavailable(RuntimeError):
    pass

def _identifier(value):
    raw = str(value or '').strip()
    return str(int(raw)) if re.fullmatch(r'[0-9]+', raw) and int(raw) > 0 else ''

def _complete_afd_records(raw, day):
    """Require the AFD671 header/range and trailer counts, not just HTTP 200."""
    lines = raw.lstrip('\ufeff').splitlines()
    if len(lines) < 2 or len(lines) >= 50000: raise RhidBadgeUnavailable(ERROR)
    header = lines[0]
    if not header.startswith('0000000001') or len(header) < 302: raise RhidBadgeUnavailable(ERROR)
    try:
        start, end = (date.fromisoformat(header[index:index + 10]) for index in (206, 216))
    except ValueError: raise RhidBadgeUnavailable(ERROR) from None
    if not start.isoformat() <= day <= end.isoformat(): raise RhidBadgeUnavailable(ERROR)
    trailers = [index for index, line in enumerate(lines) if re.fullmatch(r'999999999[0-9]{54}9', line)]
    if len(trailers) != 1: raise RhidBadgeUnavailable(ERROR)
    index = trailers[0]
    tail = lines[index + 1:]
    if tail and (len(tail) != 1 or len(tail[0]) != 100): raise RhidBadgeUnavailable(ERROR)
    records = lines[1:index]
    minimum = {'2': 331, '3': 50, '4': 73, '5': 118, '6': 36, '7': 137}
    counts = {kind: 0 for kind in minimum}
    for record in records:
        if len(record) < 10 or not record[:9].isdigit() or record[9] not in minimum:
            raise RhidBadgeUnavailable(ERROR)
        kind = record[9]
        if len(record) < minimum[kind]: raise RhidBadgeUnavailable(ERROR)
        counts[kind] += 1
    trailer = lines[index]
    if any(counts[kind] != int(trailer[9 + offset * 9:18 + offset * 9])
           for offset, kind in enumerate('234567')): raise RhidBadgeUnavailable(ERROR)
    return records

class RhidBadgeSource:
    def __init__(self, credentials, *, transport=None, clock=time.monotonic):
        self._credentials = {key: credentials[key] for key in ('email', 'password', 'system') if key in credentials}
        self._transport = transport or requests.Session()
        self._clock = clock
        self._lock = threading.Lock()
        self._token = ''
        self._token_until = 0
        self._directory = None
        self._directory_until = 0
        self._reports = {}

    def _json(self, response):
        if response.status_code != 200:
            if response.status_code in (400, 401, 403): self._token_until = 0
            raise RhidBadgeUnavailable(ERROR)
        result = response.json()
        if not isinstance(result, dict): raise RhidBadgeUnavailable(ERROR)
        return result

    def _headers(self):
        if self._token_until <= self._clock():
            payload = self._json(self._transport.post(API + '/login', json=self._credentials,
                                                     timeout=(5, 10), allow_redirects=False))
            token = payload.get('accessToken')
            if not isinstance(token, str) or not token.strip(): raise RhidBadgeUnavailable(ERROR)
            self._token, self._token_until = token, self._clock() + 900
        return {'Authorization': 'Bearer ' + self._token}

    def _people(self):
        if self._directory is not None and self._directory_until > self._clock(): return self._directory
        records, identifiers, total = [], set(), None
        for _ in range(50):
            payload = self._json(self._transport.get(API + '/person', params={'start': len(records), 'length': 100},
                                                     headers=self._headers(), timeout=(5, 10), allow_redirects=False))
            expected, page = payload.get('totalRecords'), payload.get('records')
            if (not isinstance(expected, int) or isinstance(expected, bool) or expected < 0 or expected > 5000
                or not isinstance(page, list) or (total is not None and expected != total)):
                raise RhidBadgeUnavailable(ERROR)
            total = expected
            for item in page:
                if not isinstance(item, dict): raise RhidBadgeUnavailable(ERROR)
                identifier, name = _identifier(item.get('id')), str(item.get('name') or '').strip()
                if not identifier or not name or identifier in identifiers: raise RhidBadgeUnavailable(ERROR)
                identifiers.add(identifier)
                records.append({'id': identifier, 'name': name, 'pis': _identifier(item.get('pis'))})
            if len(records) == total: break
            if not page or len(records) > total: raise RhidBadgeUnavailable(ERROR)
        if len(records) != total: raise RhidBadgeUnavailable(ERROR)
        self._directory, self._directory_until = records, self._clock() + 300
        return records

    def _punches(self, day, people):
        response = self._transport.get(API + '/report/afd/download671',
            params={'idEquipamento': 1, 'dataIni': day, 'dataFinal': day, 'limit': 50000},
            headers=self._headers(), timeout=(5, 10), allow_redirects=False)
        if response.status_code != 200: raise RhidBadgeUnavailable(ERROR)
        try: raw = response.json()
        except ValueError: raw = response.text
        if not isinstance(raw, str): raise RhidBadgeUnavailable(ERROR)
        # A blank/error/truncated download is not evidence of an absent worker.
        lines = _complete_afd_records(raw, day)
        by_pis = {}
        for person in people:
            if person['pis']: by_pis.setdefault(person['pis'], []).append(person['id'])
        punches = {person['id']: [] for person in people}
        for line in lines:
            if len(line) < 10 or line[9] != '3': continue
            if len(line) < 46: raise RhidBadgeUnavailable(ERROR)
            if line[10:20] != day: continue
            pis = _identifier(line[34:46])
            matches = by_pis.get(pis, [])
            # Unresolved PIS cannot be guessed, especially for namesakes.
            if len(matches) != 1: raise RhidBadgeUnavailable(ERROR)
            punches[matches[0]].append(line[21:26])
        return punches

    def get_report(self, selected_date):
        try: day = date.fromisoformat(selected_date)
        except (TypeError, ValueError) as exc: raise ValueError('Data RHID inválida.') from exc
        if day.isoformat() != selected_date: raise ValueError('Data RHID inválida.')
        with self._lock:
            cached = self._reports.get(selected_date)
            if cached and cached[0] > self._clock(): return deepcopy(cached[1])
            try:
                people = self._people()
                punches = self._punches(selected_date, people)
                collected = datetime.now(timezone.utc).isoformat()
                report = {'date': selected_date, 'registration': {'complete': True,
                    'source': 'RHID /person', 'collectedAt': collected,
                    'people': [{'id': person['id'], 'name': person['name']} for person in people]},
                    'rows': [{'Id': 'rhid:' + person['id'], 'ID_PESSOA_RHID': person['id'],
                        'DATA_REFERENCIA': selected_date, 'NOME_COLABORADOR': person['name'],
                        'BATIDAS_RHID': punches[person['id']], 'MINUTOS_TRABALHADOS': None,
                        'STATUS_RHID': 'REGISTRADO' if punches[person['id']] else 'SEM BATIDAS',
                        'COLETADO_EM': collected, 'ORIGEM_ULTIMA_ALTERACAO': 'RHID - CONSULTA LEITURA'} for person in people]}
                if len(self._reports) >= 32: self._reports.pop(next(iter(self._reports)))
                self._reports[selected_date] = (self._clock() + 60, report)
                return deepcopy(report)
            except RhidBadgeUnavailable:
                raise
            except Exception as exc:
                # Never expose response bodies, tokens, credentials or private rows.
                raise RhidBadgeUnavailable(ERROR) from None

_source = None
_source_lock = threading.Lock()

def get_rhid_badge_report(selected_date):
    global _source
    with _source_lock:
        if _source is None:
            try: credentials = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
            except Exception: raise RhidBadgeUnavailable(ERROR) from None
            if not isinstance(credentials, dict): raise RhidBadgeUnavailable(ERROR)
            _source = RhidBadgeSource(credentials)
    return _source.get_report(selected_date)
