"""Synthetic wire transport; use the real certificate client's REST machinery."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from xml.etree import ElementTree as ET

import requests

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT']).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT)]
from clients import SharePointClient


def module(name, path=None):
    if path:
        spec = importlib.util.spec_from_file_location(name, path)
        result = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(result)
        return result
    return __import__(name)


def field(name, kind='Text', title=None, **extra):
    return {'InternalName': name, 'Title': title or name, 'TypeAsString': kind,
            'ReadOnlyField': False, 'Hidden': False, 'Required': False,
            'EnforceUniqueValues': name == 'IDFORNECEDORORIGEM',
            'Indexed': name == 'IDFORNECEDORORIGEM',
            'SchemaXml': f'<Field Name="{name}" Type="{kind}" Format="DateOnly" />', **extra}


def fields():
    text = ['Title', 'IDFORNECEDORORIGEM', 'CARGO', 'EMPREITEIRO', 'STATUS', 'FILIAL',
            'TIPO', 'CIDADE', 'VINCULO', 'HOMOLOGACAO', 'TIPODOCUMENTO',
            'DOCUMENTOFORNECEDOR', 'TELEFONECONTATO', 'WHATSAPP', 'EMAIL', 'PROFISSAO',
            'FORMAPGTO', 'VLRDIARIO', 'HORASTRABALHO', 'MEDICAOATUAL', 'IMOVEL']
    return [field(n, title='CADASTRO' if n == 'Title' else n) for n in text] + [
        field(n, 'Note') for n in ['ENDERECO', 'DESCRITIVOETAPAATUAL', 'ATIVIDADEEXERCIDA']] + [
        field(n, 'DateTime') for n in ['DATAADMISSAO', 'DATADESLIGAMENTO', 'DATANASCIMENTO']]


class Transport:
    def __init__(self, exists=True):
        self.fields = fields() if exists else None
        self.rows = {}
        self.files = {}
        self.calls = []
        self.posts = 0
        self.list_posts = 0
        self.lost_create = False
        self.lost_list = False
        self.hidden = False
        self.hide_list = False
        self.fail_attachment = False
        self.fail_attachment_after = None
        self.attachment_posts = 0
        self.corrupt_attachment = False
        self.corrupt_field = False
        self.page_size = 100
        self.next_override = None
        self.before_post = None

    @staticmethod
    def response(body=None, status=200, binary=None):
        response = requests.Response()
        response.status_code = status
        response._content = binary if binary is not None else json.dumps(body or {}).encode()
        response.headers['ETag'] = '"1"'
        return response

    def request(self, method, url, **kw):
        self.calls.append((method, url, copy.deepcopy(kw)))
        path = unquote(urlsplit(url).path.split('/_api/')[-1])
        assert 'FORNECEDORES' not in path, 'HR must never read source data or schema'
        assert not any(s in path.casefold() for s in ['roleassign', 'roleinherit']), 'No ACL access'
        params = kw.get('params') or {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        body = kw.get('json') or {}
        if path == 'web/lists' and method == 'POST':
            assert body['Title'] == 'FUNCIONARIOSRH'
            assert self.fields is None, 'Duplicate list creation'
            self.list_posts += 1
            self.fields = [field('Title')]
            if self.lost_list:
                self.lost_list = False
                raise requests.Timeout('synthetic lost response')
            return self.response({'Title': 'FUNCIONARIOSRH'}, 201)
        match = re.fullmatch(r"web/lists/[Gg]et[Bb]y[Tt]itle\('FUNCIONARIOSRH'\)(.*)", path)
        assert match, (method, path)
        tail = match[1]
        if self.fields is None or self.hide_list:
            return self.response(status=404)
        if not tail:
            assert method == 'GET', 'No list access/permission mutation'
            return self.response({'Title': 'FUNCIONARIOSRH', 'ItemCount': len(self.rows), 'EnableAttachments': True})
        if tail == '/fields':
            assert method == 'GET'
            return self.response({'value': self.fields})
        if tail == '/fields/createfieldasxml':
            node = ET.fromstring(body['parameters']['SchemaXml'])
            name = node.get('Name')
            assert name not in {f['InternalName'] for f in self.fields}
            self.fields.append(field(name, node.get('Type'), node.get('DisplayName'),
                SchemaXml=ET.tostring(node, encoding='unicode'),
                Indexed=node.get('Indexed') == 'TRUE', EnforceUniqueValues=node.get('EnforceUniqueValues') == 'TRUE'))
            return self.response({'InternalName': name}, 201)
        if tail == "/fields/getByInternalNameOrTitle('Title')":
            assert method == 'POST' and body == {'Title': 'CADASTRO'}
            next(f for f in self.fields if f['InternalName'] == 'Title').update(body)
            return self.response(status=204)
        if tail == '/items':
            if method == 'POST':
                if self.before_post:
                    self.before_post()
                assert body['IDFORNECEDORORIGEM'] not in [r['IDFORNECEDORORIGEM'] for r in self.rows.values()]
                self.posts += 1
                item_id = 101 + len(self.rows)
                self.rows[item_id] = {'Id': item_id, **copy.deepcopy(body)}
                if self.corrupt_field:
                    self.rows[item_id]['CARGO'] = 'WRONG'
                if self.lost_create:
                    self.lost_create = False
                    raise requests.Timeout('synthetic lost POST response')
                return self.response({'Id': item_id}, 201)
            assert method == 'GET'
            key = re.search(r"IDFORNECEDORORIGEM eq '(\d+)'", params.get('$filter', ''))
            rows = [] if self.hidden else list(self.rows.values())
            if key:
                rows = [r for r in rows if r['IDFORNECEDORORIGEM'] == key[1]]
            start = int(params.get('$skiptoken', 0))
            result = {'value': rows[start:start + self.page_size]}
            if start + self.page_size < len(rows):
                result['@odata.nextLink'] = url.split('?')[0] + '?' + urlencode({**params, '$skiptoken': start + self.page_size})
            if self.next_override:
                result['@odata.nextLink'] = self.next_override
            return self.response(result)
        match = re.fullmatch(r'/items\((\d+)\)(.*)', tail)
        assert match, (method, path)
        item_id, suffix = int(match[1]), match[2]
        if not suffix:
            assert method == 'GET', 'Registration must never update existing history'
            return self.response(self.rows[item_id]) if item_id in self.rows else self.response(status=404)
        files = self.files.setdefault(item_id, {})
        if suffix == '/AttachmentFiles':
            assert method == 'GET'
            return self.response({'value': [{'FileName': name} for name in files]})
        match = re.fullmatch(r"/AttachmentFiles(?:/getByFileName\('(.*)'\)/\$value|/add\(FileName='(.*)'\))", suffix)
        assert match, (method, path)
        name = (match[1] or match[2]).replace("''", "'")
        if method == 'GET':
            return self.response(binary=files[name])
        if self.fail_attachment or (self.fail_attachment_after is not None and self.attachment_posts >= self.fail_attachment_after):
            raise requests.Timeout('synthetic file failure')
        assert name not in files, 'Never overwrite attachments'
        files[name] = b'CORRUPT' if self.corrupt_attachment else kw['data']
        self.attachment_posts += 1
        return self.response(status=201)


def client(remote):
    value = SharePointClient('synthetic.invalid', 'sites/synthetic', 'synthetic', 'synthetic', '', '', 'FUNCIONARIOSRH')
    value._token = lambda refresh=False: 'synthetic'
    value.session = remote
    return value
