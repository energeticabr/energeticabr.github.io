"""Exercise the running worker source with fictitious catalog entries."""
import ast
from pathlib import Path
import re
import sys
import unicodedata
import unittest


def load_search(source):
    tree = ast.parse(source.read_bytes())
    functions = {
        "normalize_text", "normalize_search_text", "compact_search_text",
        "matches_search_terms", "filter_options",
    }
    tree.body = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name in functions]
    namespace = {"re": re, "unicodedata": unicodedata}
    exec(compile(tree, str(source), "exec"), namespace)
    return namespace["filter_options"]


class SearchTests(unittest.TestCase):
    def test_options_match_both_spellings(self):
        labels = ["VERGALHÃO 6.3", "VERGALHÃO 6,3", "VERGALHÃO 63",
                  "VERGALHÃO 8 MM", "VERGALHÃO 8MM", "VERGALHÃO 8 CM", "VERGALHÃO 8 ROLOS DE 10 MM"]
        options = [{"id": str(index), "title": title} for index, title in enumerate(labels)]
        for query, expected in (
            ("6.3", options[:2]),
            ("vergalhao 6,3", options[:2]),
            ("8mm", options[3:5]),
            ("vergalhao 8 mm", options[3:5]),
            ("8 mm vergalhao", options[3:5]),
            ("vergalhao8mm", options[3:5]),
            ("", []),
        ):
            with self.subTest(query=query):
                self.assertEqual(filter_options(query, options), expected)


if __name__ == "__main__":
    filter_options = load_search(Path(sys.argv.pop(1)))
    unittest.main()
