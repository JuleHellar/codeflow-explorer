import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from analyzer import analyse  # type: ignore[reportMissingImports]


class AnalyzerTests(unittest.TestCase):
    def test_ids_are_stable_when_source_lines_shift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python_file = root / "sample.py"
            fortran_file = root / "sample.f90"
            python_file.write_text(
                "class Example:\n"
                "    def method(self):\n"
                "        pass\n"
                "\n"
                "def helper():\n"
                "    pass\n",
                encoding="utf-8",
            )
            fortran_file.write_text(
                "module sample_module\n"
                "  type :: sample_type\n"
                "    integer :: value\n"
                "  end type sample_type\n"
                "contains\n"
                "  subroutine work()\n"
                "  end subroutine work\n"
                "end module sample_module\n",
                encoding="utf-8",
            )

            before = analyse(root)
            python_file.write_text("# shifted\n" + python_file.read_text(encoding="utf-8"),
                                   encoding="utf-8")
            fortran_file.write_text("! shifted\n" + fortran_file.read_text(encoding="utf-8"),
                                    encoding="utf-8")
            after = analyse(root)

        def ids_by_entity(result):
            ids = {}
            for file in result["files"]:
                for cls in file["classes"]:
                    ids[("class", file["path"], cls["qualifiedName"])] = cls["id"]
                for fn in file["functions"]:
                    ids[("function", file["path"], fn["qualifiedName"])] = fn["id"]
            return ids

        self.assertEqual(ids_by_entity(before), ids_by_entity(after))

    def test_python_analysis_still_resolves_imported_calls(self):
        fixture = Path(__file__).parent / "fixture_project"
        result = analyse(fixture)

        calls = {
            (edge["source"], edge["target"])
            for edge in result["edges"]
        }
        functions = {
            fn["name"]: fn["id"]
            for file in result["files"]
            for fn in file["functions"]
        }
        self.assertIn(
            (functions["create_invoice"], functions["discount_for_customer"]),
            calls,
        )
        self.assertIn(
            (functions["create_invoice"], functions["calculate_tax"]),
            calls,
        )

    def test_fortran_modules_subroutines_functions_and_use_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "math_ops.f90").write_text(
                """module math_ops
  implicit none
  type :: measurement
    real :: value
  end type measurement
contains
  subroutine scale_value(input, output)
    real, intent(in) :: input
    real, intent(out) :: output
    output = double_value(input)
  end subroutine scale_value

  real function double_value(value) result(answer)
    real, intent(in) :: value
    answer = value * 2.0
  end function double_value
end module math_ops
""",
                encoding="utf-8",
            )
            (root / "main.f90").write_text(
                """program example
  use math_ops
  real :: result
  call scale_value(2.0, result)
  result = double_value(result)
end program example
""",
                encoding="utf-8",
            )
            (root / "alias_user.f90").write_text(
                """program alias_example
  use math_ops, only: apply_scale => scale_value
  real :: result
  call apply_scale(2.0, result)
end program alias_example
""",
                encoding="utf-8",
            )

            result = analyse(root)

        self.assertEqual(result["filesScanned"], 3)
        helper_file = next(file for file in result["files"] if file["path"] == "math_ops.f90")
        main_file = next(file for file in result["files"] if file["path"] == "main.f90")
        alias_file = next(file for file in result["files"] if file["path"] == "alias_user.f90")
        helper_functions = {fn["name"]: fn for fn in helper_file["functions"]}
        main_functions = {fn["name"]: fn for fn in main_file["functions"]}
        alias_functions = {fn["name"]: fn for fn in alias_file["functions"]}

        self.assertEqual([param["name"] for param in helper_functions["scale_value"]["params"]],
                         ["input", "output"])
        self.assertEqual(helper_functions["double_value"]["returns"], ["answer"])
        self.assertEqual(
            {cls["name"] for cls in helper_file["classes"]},
            {"math_ops", "measurement"},
        )

        edges = {
            (edge["source"], edge["target"])
            for edge in result["edges"]
        }
        self.assertIn(
            (main_functions["example"]["id"], helper_functions["scale_value"]["id"]),
            edges,
        )
        self.assertIn(
            (main_functions["example"]["id"], helper_functions["double_value"]["id"]),
            edges,
        )
        self.assertIn(
            (alias_functions["alias_example"]["id"], helper_functions["scale_value"]["id"]),
            edges,
        )
        self.assertIn(
            (helper_functions["scale_value"]["id"], helper_functions["double_value"]["id"]),
            edges,
        )

    def test_fortran_fixture_project_produces_cross_file_call_graph(self):
        fixture = Path(__file__).parent / "fixture_fortran"
        result = analyse(fixture)

        self.assertEqual(result["filesScanned"], 7)
        functions = {
            fn["name"]: fn
            for file in result["files"]
            for fn in file["functions"]
        }
        edges = {
            (edge["source"], edge["target"])
            for edge in result["edges"]
        }
        self.assertIn(
            (functions["checkout_demo"]["id"], functions["load_customer"]["id"]),
            edges,
        )
        self.assertIn(
            (functions["checkout_demo"]["id"], functions["update_contact"]["id"]),
            edges,
        )
        self.assertIn(
            (functions["create_invoice"]["id"], functions["discount_for_customer"]["id"]),
            edges,
        )
        self.assertIn(
            (functions["create_invoice"]["id"], functions["calculate_tax"]["id"]),
            edges,
        )
        self.assertIn(
            (functions["checkout_demo"]["id"], functions["print_receipt"]["id"]),
            edges,
        )

    def test_fixed_form_fortran_subroutine_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "legacy.for").write_text(
                "      SUBROUTINE ALPHA(X)\n"
                "      CALL BETA(X)\n"
                "      END\n"
                "      SUBROUTINE BETA(X)\n"
                "      END\n",
                encoding="utf-8",
            )

            result = analyse(root)

        functions = {fn["name"].lower(): fn for fn in result["files"][0]["functions"]}
        self.assertEqual(len(result["edges"]), 1)
        self.assertEqual(result["edges"][0]["source"], functions["alpha"]["id"])
        self.assertEqual(result["edges"][0]["target"], functions["beta"]["id"])


if __name__ == "__main__":
    unittest.main()
