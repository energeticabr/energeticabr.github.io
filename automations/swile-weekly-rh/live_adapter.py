"""Narrow REST adapter using the existing authenticated SharePoint client.

Credentials stay in the caller's server process. This adapter never changes
schema, retries a mutation, or writes payment/order/payroll fields.
"""
from copy import deepcopy
import importlib.util
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlparse, urlencode


_spec = importlib.util.spec_from_file_location('swile_adapter_model', Path(__file__).with_name('model.py'))
model = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(model)

LISTS = {
    model.RH: '8311a380-ee1e-42eb-a529-7452a47b0ae3',
    model.PARENT: '514bf67a-9e76-4bfc-99b7-1f7297ae611a',
    model.CHILD: '6e5c235e-797a-4a86-8c05-25e0ab6ad870',
    model.LEGACY: '1fb01079-31c0-4cb9-bf5a-659a3a6ccdad',
}
CREATE_FIELDS = {
    model.PARENT: {'Title', 'FOLHAOPERACAO', 'FORNECEDOR', 'FILIAL', 'VALORTOTAL',
                   'OBS', 'FORMAPGTO', 'STATUS', 'DATAPREVISTOPGTO'},
    model.CHILD: {'Title', 'FOLHAOPERACAO', 'DESCRITIVOPROVISAO', 'FORNECEDOR',
                  'FILIAL', 'IMOVEL', 'PRODUTO', 'OBS', 'FORMAPGTO', 'QTD',
                  'VALORTOTAL', 'FRETE', 'STATUS', 'PGTOAGENDADO', 'DATA', 'DATAPREVISTOPGTO'},
}


def _etag(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:W/)?"[^"\r\n*]+"', value):
        raise ValueError('ETag exato obrigatório')
    return value


class SharePointAdapter:
    def __init__(self, client):
        self.client = client
        self.root = client.site_url.rstrip('/') + '/_api/'

    @staticmethod
    def _base(title):
        if title not in LISTS:
            raise ValueError('Lista fora do escopo SWILE')
        return "web/lists(guid'" + LISTS[title] + "')"

    def _request(self, method, endpoint, **kwargs):
        headers = {'Accept': 'application/json;odata=minimalmetadata', **kwargs.pop('headers', {})}
        return self.client._request(method, endpoint, headers=headers, _return_response=True, **kwargs)

    @staticmethod
    def _row(raw, response_etag=None):
        if not isinstance(raw, dict):
            raise ValueError('Resposta de item inválida')
        row = deepcopy(raw.get('d', raw))
        row['Id'] = model.identity(row.get('Id', row.get('ID')))
        row['audit_etag'] = _etag(row.get('odata.etag') or row.get('@odata.etag')
                                 or row.get('__metadata', {}).get('etag') or response_etag)
        return {key: value for key, value in row.items()
                if not key.startswith(('odata.', '@odata.')) and key != '__metadata'}

    def _pages(self, title, params):
        endpoint = self._base(title) + '/items'
        expected = urlparse(self.root + endpoint)
        seen, row_ids, rows = set(), set(), []
        for _ in range(200):
            url = endpoint if endpoint.startswith('https://') else self.root + endpoint
            parsed = urlparse(url)
            if (parsed.scheme, parsed.netloc, parsed.path) != (expected.scheme, expected.netloc, expected.path):
                raise ValueError('Paginação saiu da lista selecionada')
            query = parse_qsl(parsed.query, keep_blank_values=True) + list((params or {}).items())
            canonical = parsed.path + '?' + urlencode(sorted((k, str(v)) for k, v in query))
            if canonical in seen:
                raise ValueError('Paginação repetida')
            seen.add(canonical)
            payload = self._request('GET', endpoint, params=params).json()
            data = payload.get('d', payload)
            values = data.get('value', data.get('results'))
            if not isinstance(values, list):
                raise ValueError('Página SharePoint inválida')
            for raw in values:
                row = self._row(raw)
                if row['Id'] in row_ids:
                    raise ValueError('Item duplicado durante paginação')
                row_ids.add(row['Id'])
                rows.append(row)
            next_link = data.get('odata.nextLink') or data.get('@odata.nextLink') or data.get('__next')
            if not next_link:
                return rows
            if not isinstance(next_link, str) or not next_link.startswith(self.root):
                raise ValueError('Link de paginação inesperado')
            endpoint, params = next_link, None
        raise ValueError('Leitura incompleta: limite de paginação atingido')

    def all_rows(self, title):
        return self._pages(title, {'$top': 1000, '$orderby': 'Id'})

    def find(self, title, field, value):
        if field not in {'FOLHAOPERACAO', 'DESCRITIVOPROVISAO'}:
            raise ValueError('Filtro fora do escopo SWILE')
        return self._pages(title, {'$top': 1000, '$orderby': 'Id',
                                  '$filter': field + " eq '" + str(value).replace("'", "''") + "'"})

    def read(self, title, item_id):
        item_id = model.identity(item_id)
        try:
            response = self._request('GET', self._base(title) + '/items(' + str(item_id) + ')')
        except Exception as error:
            if getattr(getattr(error, 'response', None), 'status_code', None) == 404:
                return None
            raise
        row = self._row(response.json(), response.headers.get('ETag'))
        if row['Id'] != item_id:
            raise ValueError('Readback retornou outro item')
        return row

    def require_unique(self, title, field):
        if title not in CREATE_FIELDS or field != 'FOLHAOPERACAO':
            raise ValueError('Chave fora do escopo SWILE')
        payload = self._request('GET', self._base(title) + "/fields/getbyinternalnameortitle('FOLHAOPERACAO')",
                                params={'$select': 'InternalName,EnforceUniqueValues,Indexed'}).json()
        data = payload.get('d', payload)
        if data.get('EnforceUniqueValues') is not True or data.get('Indexed') is not True:
            raise ValueError('FOLHAOPERACAO deve ter índice exclusivo antes de criar provisões')

    def create(self, title, fields):
        if (title not in CREATE_FIELDS or not fields or set(fields) - CREATE_FIELDS[title]
                or not str(fields.get('FOLHAOPERACAO', '')).startswith(model.PREFIX)):
            raise ValueError('Criação fora do escopo SWILE')
        return self._request('POST', self._base(title) + '/items', json=deepcopy(fields),
                             headers={'Content-Type': 'application/json;odata=nometadata'}).json()

    def patch(self, title, item_id, fields, etag):
        permitted = bool(title == model.PARENT and fields and set(fields) <= {'Title', 'VALORTOTAL'})
        permitted |= title == model.LEGACY and fields == {'STATUS': 'INATIVO'}
        if not permitted:
            raise ValueError('Atualização fora do escopo SWILE')
        return self._request('POST', self._base(title) + '/items(' + str(model.identity(item_id)) + ')',
                             json=deepcopy(fields), headers={'IF-MATCH': _etag(etag), 'X-HTTP-Method': 'MERGE',
                                                           'Content-Type': 'application/json;odata=nometadata'})

    def delete(self, title, item_id, etag):
        if title not in CREATE_FIELDS:
            raise ValueError('Exclusão fora do escopo SWILE')
        return self._request('POST', self._base(title) + '/items(' + str(model.identity(item_id)) + ')',
                             headers={'IF-MATCH': _etag(etag), 'X-HTTP-Method': 'DELETE'})
