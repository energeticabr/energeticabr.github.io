"""Synthetic HTTP transport; production SharePointClient and REST logic stay real."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from xml.etree import ElementTree as ET

import requests

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT']).resolve()
sys.path.insert(0, str(ROOT / 'worker'))
from clients import SharePointClient


def module(name, path=None):
    try:
        if path:
            spec = importlib.util.spec_from_file_location(name, path)
            result = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(result)
            return result
        return __import__(name)
    except (ModuleNotFoundError, FileNotFoundError) as error:
        class MissingImplementation:
            def __getattr__(self, attr):
                raise AssertionError(f'Missing implementation: {name}.{attr}')
        return MissingImplementation()


def field(name, kind='Text', title=None, **extra):
    return {'InternalName': name, 'Title': title or name, 'TypeAsString': kind,
            'ReadOnlyField': False, 'Hidden': False, 'EnforceUniqueValues': False,
            'Indexed': False, 'SchemaXml': f'<Field Name="{name}" StaticName="{name}" '
            f'DisplayName="{title or name}" Type="{kind}" Format="DateOnly" />', **extra}


def fields():
    return [field('Title', title='CADASTRO'), field('EMPREITEIRO'), field('STATUS'),
            field('CARGO'), field('VINCULO'), field('field_6', 'Number', 'ENDEREÇO'),
            field('DATANASCIMENTO', 'DateTime'), field('EXTRA', 'Note'),
            field('DATAADMISSAO', 'DateTime'), field('DATADESLIGAMENTO', 'DateTime'),
            field('RESPONSAVEL', 'User'), field('EQUIPE', 'UserMulti'),
            field('ID', 'Counter', ReadOnlyField=True),
            field('Author', 'User', ReadOnlyField=True),
            field('Created', 'DateTime', ReadOnlyField=True),
            field('ContentType', 'Computed'), field('Attachments', 'Attachments')]


class Transport:
    def __init__(self):
        self.fields = {'FORNECEDORES': fields(), 'FUNCIONARIOSRH': fields() + [
            field('IDFORNECEDORORIGEM', Indexed=True, EnforceUniqueValues=True),
            field('ORIGEMCRIADOEM', 'DateTime'), field('ORIGEMMODIFICADOEM', 'DateTime'),
            field('ORIGEMAUTORJSON', 'Note'), field('ORIGEMEDITORJSON', 'Note'),
            field('ORIGEMSNAPSHOTJSON', 'Note')]}
        self.items = {'FORNECEDORES': {7: {'Id': 7, 'Title': 'SYNTHETIC 7',
            'EMPREITEIRO': 'SIM', 'STATUS': 'ATIVO', 'CARGO': None, 'VINCULO': 'CLT',
            'field_6': 123.5, 'DATANASCIMENTO': '1990-01-02T03:00:00Z',
            'EXTRA': 'legacy untouched', 'DATAADMISSAO': None, 'DATADESLIGAMENTO': None,
            'RESPONSAVEL': {'Id': 12, 'Title': 'SYNTHETIC USER'},
            'EQUIPE': {'results': [{'Id': 12}, {'Id': 13}]},
            'Created': '2024-01-01T12:00:00Z', 'Modified': '2026-10-20T12:00:00Z',
            'Author': {'Id': 11, 'Title': 'SYNTHETIC AUTHOR'},
            'Editor': {'Id': 12, 'Title': 'SYNTHETIC EDITOR'},
            'Attachments': True, 'ContentTypeId': '0x01', '@odata.etag': '"1"'}},
            'FUNCIONARIOSRH': {}}
        self.files = {('FORNECEDORES', 7): {"synthetic's.pdf": b'SYNTHETIC BYTES'}}
        self.calls = []
        self.versions = {}
        self.security = {title: {'HasUniqueRoleAssignments': False, 'ReadSecurity': 1, 'WriteSecurity': 1}
                         for title in self.fields}
        self.roles = {title: {11: {1073741829}, 22: {1073741826}} for title in self.fields}
        self.fail_grant = False
        self.fail_grant_after = None
        self.grant_attempts = 0
        self.acl_history = []
        self.lost_create = False
        self.hide_target = False
        self.fail_attachment = False
        self.drop_merge = False
        self.delay_create = False
        self.lost_list = False
        self.hide_list = False
        self.multi_as_array = False
        self.page_size = 100
        self.next_override = None

    def edit(self, title, item_id, **changes):
        self.items[title][item_id].update(changes)
        self.versions[(title, item_id)] = self.versions.get((title, item_id), 1) + 1

    def response(self, body=None, status=200, binary=None):
        response = requests.Response()
        response.status_code = status
        response._content = binary if binary is not None else json.dumps(body or {}).encode()
        response.headers['ETag'] = '"1"'
        return response

    def request(self, method, url, **kw):
        self.calls.append((method, url, copy.deepcopy(kw)))
        path = unquote(urlsplit(url).path.split('/_api/')[-1])
        params = kw.get('params') or {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        body = kw.get('json') or {}
        if path == 'web/lists' and method == 'POST':
            title = body['Title']
            if title in self.fields:
                return self.response(status=409)
            self.fields[title] = [field('Title')]
            self.items[title] = {}
            self.security[title] = {'HasUniqueRoleAssignments': False, 'ReadSecurity': 1, 'WriteSecurity': 1}
            self.roles[title] = {11: {1073741829}, 22: {1073741826}, 99: {1073741827}}
            self.acl_history.append(('created', copy.deepcopy(self.roles[title])))
            if self.lost_list:
                self.lost_list = False
                raise requests.Timeout('synthetic list response lost')
            return self.response({'Title': title}, 201)
        match = re.fullmatch(r"web/lists/[Gg]et[Bb]y[Tt]itle\('([^']+)'\)(.*)", path)
        if not match:
            raise AssertionError(f'Unexpected REST request: {method} {path}')
        title, tail = match.groups()
        if self.hide_list and title == 'FUNCIONARIOSRH':
            return self.response(status=404)
        if title not in self.fields:
            return self.response(status=404)
        if not tail:
            if method == 'POST':
                assert set(body) <= {'ReadSecurity', 'WriteSecurity'}
                self.security[title].update(body)
                return self.response(status=204)
            return self.response({'Title': title, 'EnableAttachments': True, **self.security[title]})
        if tail == '/roleassignments' and method == 'GET':
            rows = [{'PrincipalId': p, 'RoleDefinitionBindings': {'results': [{'Id': role} for role in sorted(roles)]}}
                    for p, roles in sorted(self.roles[title].items())]
            start = int(params.get('$skiptoken', 0))
            result = {'value': rows[start:start + self.page_size]}
            if start + self.page_size < len(rows):
                result['@odata.nextLink'] = url.split('?')[0] + '?' + urlencode({
                    **params, '$skiptoken': start + self.page_size})
            return self.response(result)
        inheritance = re.fullmatch(r'/breakroleinheritance\(copyRoleAssignments=(true|false),clearSubscopes=false\)', tail)
        if inheritance and method == 'POST':
            self.security[title]['HasUniqueRoleAssignments'] = True
            if inheritance[1] == 'false':
                # copy=false implicitly grants caller Full Control, even if a
                # following assignment fails before cleanup can execute.
                self.roles[title] = {99: {1073741829}}
            self.acl_history.append(('inheritance_broken', copy.deepcopy(self.roles[title])))
            return self.response(status=204)
        role = re.fullmatch(r'/roleassignments/(addroleassignment|removeroleassignment)\(principalid=(\d+),roledefid=(\d+)\)', tail)
        if role and method == 'POST':
            action, principal, definition = role[1], int(role[2]), int(role[3])
            if action == 'addroleassignment':
                self.grant_attempts += 1
                if self.fail_grant or (self.fail_grant_after is not None and self.grant_attempts > self.fail_grant_after):
                    self.acl_history.append(('grant_failed', copy.deepcopy(self.roles[title])))
                    return self.response(status=403)
                self.roles[title].setdefault(principal, set()).add(definition)
            else:
                self.roles[title][principal].remove(definition)
                if not self.roles[title][principal]:
                    del self.roles[title][principal]
            self.acl_history.append((action, copy.deepcopy(self.roles[title])))
            return self.response(status=204)
        if tail == '/fields' and method == 'GET':
            return self.response({'value': self.fields[title]})
        if tail == '/fields/createfieldasxml' and method == 'POST':
            xml = body['parameters']['SchemaXml']
            node = ET.fromstring(xml)
            name = node.attrib['Name']
            assert name not in {f['InternalName'] for f in self.fields[title]}
            self.fields[title].append(field(name, node.attrib['Type'], node.attrib.get('DisplayName'),
                SchemaXml=xml, Indexed=node.attrib.get('Indexed') == 'TRUE',
                EnforceUniqueValues=node.attrib.get('EnforceUniqueValues') == 'TRUE'))
            return self.response({'InternalName': name}, 201)
        match = re.fullmatch(r"/fields/[Gg]et[Bb]y[Ii]nternal[Nn]ame[Oo]r[Tt]itle\('([^']+)'\)", tail)
        if match and method == 'POST':
            f = next(f for f in self.fields[title] if f['InternalName'] == match[1])
            f.update(body)
            return self.response(status=204)
        if tail == '/items':
            if method == 'POST':
                if self.delay_create:
                    time.sleep(.1)
                key = body['IDFORNECEDORORIGEM']
                if any(r.get('IDFORNECEDORORIGEM') == key for r in self.items[title].values()):
                    return self.response(status=409)
                item_id = max(self.items[title], default=100) + 1
                self.items[title][item_id] = {'Id': item_id, **copy.deepcopy(body)}
                if self.lost_create:
                    self.lost_create = False
                    raise requests.Timeout('synthetic create response lost')
                return self.response({'Id': item_id}, 201)
            rows = list(self.items[title].values())
            if title == 'FUNCIONARIOSRH' and self.hide_target:
                rows = []
            filter_ = params.get('$filter', '')
            match = re.search(r"IDFORNECEDORORIGEM eq '([0-9]+)'", filter_)
            if match:
                rows = [r for r in rows if r.get('IDFORNECEDORORIGEM') == match[1]]
            start = int(params.get('$skiptoken', 0))
            page = rows[start:start + self.page_size]
            if params.get('$select') and params['$select'] != '*':
                selected = params['$select'].split(',')
                page = [{k: row[k] for k in selected if k in row} for row in page]
            result = {'value': page}
            if start + self.page_size < len(rows):
                result['@odata.nextLink'] = url.split('?')[0] + '?' + urlencode({
                    **params, '$skiptoken': start + self.page_size})
            if self.next_override:
                result['@odata.nextLink'] = self.next_override
            return self.response(result)
        match = re.fullmatch(r'/items\((\d+)\)(.*)', tail)
        if not match:
            raise AssertionError(f'Unexpected REST request: {method} {path}')
        item_id, suffix = int(match[1]), match[2]
        if not suffix:
            if item_id not in self.items[title]:
                return self.response(status=404)
            if method == 'GET':
                row = copy.deepcopy(self.items[title][item_id])
                row.setdefault('HasUniqueRoleAssignments', False)
                if self.multi_as_array and title == 'FUNCIONARIOSRH' and isinstance(row.get('EQUIPEId'), dict):
                    row['EQUIPEId'] = row['EQUIPEId']['results']
                selected = params.get('$select', '*').split(',')
                if '*' not in selected:
                    row = {k: row[k] for k in selected if k in row}
                etag = f'"{self.versions.get((title, item_id), 1)}"'
                row['@odata.etag'] = etag
                response = self.response(row)
                response.headers['ETag'] = etag
                return response
            assert kw['headers']['X-HTTP-Method'] == 'MERGE'
            expected = kw['headers'].get('IF-MATCH')
            if expected not in ('*', f'"{self.versions.get((title, item_id), 1)}"'):
                return self.response(status=412)
            if not self.drop_merge:
                self.edit(title, item_id, **copy.deepcopy(body))
            return self.response(status=204)
        files = self.files.setdefault((title, item_id), {})
        if suffix == '/AttachmentFiles':
            return self.response({'value': [{'FileName': n} for n in files]})
        match = re.fullmatch(r"/AttachmentFiles(?:/getByFileName\('(.*)'\)/\$value|/add\(FileName='(.*)'\))", suffix)
        if not match:
            raise AssertionError(f'Unexpected attachment request: {path}')
        name = (match[1] or match[2]).replace("''", "'")
        if method == 'GET':
            return self.response(binary=files[name])
        if self.fail_attachment:
            raise requests.Timeout('synthetic attachment failure')
        assert name not in files, 'Do not overwrite attachments'
        files[name] = kw['data']
        self.edit(title, item_id)
        return self.response(status=201)


def client(transport):
    result = SharePointClient('synthetic.invalid', 'sites/synthetic', 'synthetic',
                             'synthetic', '', '', 'FORNECEDORES')
    result._token = lambda refresh=False: 'synthetic'
    result.session = transport
    return result
