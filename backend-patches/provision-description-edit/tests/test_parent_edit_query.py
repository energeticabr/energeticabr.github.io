"""Read-only REST projection checks, using synthetic schema/rows only."""
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT), str(ROOT / 'worker')]
import provision_description_query as query


class ParentEditQueryTests(unittest.TestCase):
    def test_both_public_read_paths_return_authoritative_optional_values(self):
        schemas = {
            query.PARENT_LIST: [*query.PARENT_FIELDS, *query.OPTIONAL_PARENT_FIELDS],
            query.CHILD_LIST: [*query.CHILD_FIELDS, *query.OPTIONAL_CHILD_FIELDS]}
        parent = {field: None for field in schemas[query.PARENT_LIST]}
        parent.update(Id=7, STATUS='PAGAMENTO PREVISTO', DATAPGTOAGENDADO='2026-11-03T12:30:00Z')
        child = {field: None for field in schemas[query.CHILD_LIST]}
        child.update(Id=11, DESCRITIVOPROVISAO='7', STATUS='PAGAMENTO PREVISTO',
            QTD='2', FRETE='0', DATAPGTOAGENDADO='2026-11-03T12:30:00Z', **{'VALOR TOTAL': '10'})
        class Client:
            _list_endpoint = staticmethod(lambda name: name)
            _internal_field = staticmethod(lambda name, field: {'DATAPREVISTOPGTO': 'DATA PREVISTO PGTO',
                'DATAPGTOEFETUADO': 'DATA PGTO EFETUADO'}.get(field, field))
            _values = staticmethod(lambda payload: payload['value'])
            def _request(self, method, endpoint, params=None):
                assert method == 'GET'
                title = endpoint.split('/')[0]
                if endpoint.endswith('/fields'):
                    return {'value': [{'Title': name, 'InternalName': name} for name in schemas[title]]}
                item = parent if title == query.PARENT_LIST else child
                selected = params['$select'].split(',')
                row = {field: item[field] for field in selected}
                return row if '/items(' in endpoint else {'value': [row]}
        reader = query.ProvisionDescriptionQuery(Client())
        for result in (reader.get_pending_provision_descriptions()[0], reader.get_provision_description(7)):
            self.assertEqual(result['STATUS'], 'PAGAMENTO PREVISTO')
            self.assertEqual(result['DATAPGTOAGENDADO'], '2026-11-03T12:30:00Z')
            self.assertEqual(result['CHILDREN'][0]['DATAPGTOAGENDADO'], result['DATAPGTOAGENDADO'])

    def projection(self, title, fields, optional, available):
        class Client:
            _list_endpoint = staticmethod(lambda name: name)
            _internal_field = staticmethod(lambda name, field: 'internal_' + field)
        reader = query.ProvisionDescriptionQuery(Client())
        reader._pages = lambda *args, **kwargs: [{'Title': name, 'InternalName': 'internal_' + name}
            for name in available]
        return reader._projection(title, fields, optional=optional)

    def test_parent_reads_optional_shared_columns_when_schema_has_them(self):
        optional = query.OPTIONAL_PARENT_FIELDS
        self.assertEqual(set(optional), {'STATUS', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'})
        projection = self.projection(query.PARENT_LIST, query.PARENT_FIELDS, optional,
            [*query.PARENT_FIELDS, *optional])
        self.assertTrue(set(optional) <= projection.keys())
        with self.assertRaises(ValueError):
            query.ProvisionDescriptionQuery._row({value: None for key, value in projection.items()
                if key != 'DATAPGTOAGENDADO'}, projection)

    def test_child_reads_scheduling_columns_without_requiring_schema_migration(self):
        optional = query.OPTIONAL_CHILD_FIELDS
        self.assertTrue({'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'} <= set(optional))
        projection = self.projection(query.CHILD_LIST, query.CHILD_FIELDS, optional,
            [*query.CHILD_FIELDS, *optional])
        self.assertTrue(set(optional) <= projection.keys())

    def test_legacy_schema_omits_optional_columns_but_keeps_required_projection(self):
        for title, required, optional in [
            (query.PARENT_LIST, query.PARENT_FIELDS, query.OPTIONAL_PARENT_FIELDS),
            (query.CHILD_LIST, query.CHILD_FIELDS, query.OPTIONAL_CHILD_FIELDS)]:
            self.assertEqual(set(self.projection(title, required, optional, required)), set(required))


if __name__ == '__main__':
    unittest.main()
