import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from analyzer import analyse  # type: ignore[reportMissingImports]


class AnalyzerTests(unittest.TestCase):
    def test_flow_kickoff_start_and_listen_relationships(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "flow.py").write_text(
                "from workflow import Flow, listen, start\n"
                "\n"
                "class PurchaseFlow(Flow):\n"
                "    @start()\n"
                "    def validate_cart(self):\n"
                "        pass\n"
                "\n"
                "    @listen(validate_cart)\n"
                "    def confirm_purchase(self):\n"
                "        pass\n"
                "\n"
                "def purchase_items():\n"
                "    flow = PurchaseFlow()\n"
                "    flow.kickoff()\n",
                encoding="utf-8",
            )

            result = analyse(root)

        file = result["files"][0]
        functions = {fn["name"]: fn for fn in file["functions"]}
        validate = functions["validate_cart"]
        confirm = functions["confirm_purchase"]
        purchase = functions["purchase_items"]
        purchase_flow = file["classes"][0]
        edges = {
            (edge["source"], edge["target"])
            for edge in result["edges"]
        }

        self.assertEqual(validate["flowRole"], "start")
        self.assertEqual(confirm["flowRole"], "listener")
        self.assertEqual(confirm["flowListeners"], ["validate_cart"])
        self.assertIn((purchase["id"], purchase_flow["id"]), edges)
        self.assertIn((purchase["id"], validate["id"]), edges)
        self.assertIn((validate["id"], confirm["id"]), edges)

    def test_imported_class_constructors_and_instance_methods_are_analyzed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "main.py").write_text(
                "from models import Cart, Product\n"
                "\n"
                "def checkout():\n"
                "    product = Product()\n"
                "    product.validate()\n"
                "    cart = Cart()\n"
                "    cart.add(product)\n",
                encoding="utf-8",
            )
            (root / "models.py").write_text(
                "class Product:\n"
                "    def validate(self):\n"
                "        pass\n"
                "\n"
                "class Cart:\n"
                "    def add(self, product):\n"
                "        pass\n",
                encoding="utf-8",
            )

            result = analyse(root)

        functions = {
            fn["qualifiedName"]: fn
            for file in result["files"]
            for fn in file["functions"]
        }
        classes = {
            cls["qualifiedName"]: cls
            for file in result["files"]
            for cls in file["classes"]
        }
        checkout = functions["main.checkout"]
        edges = {
            (edge["source"], edge["target"])
            for edge in result["edges"]
        }

        self.assertIn((checkout["id"], classes["models.Product"]["id"]), edges)
        self.assertIn((checkout["id"], classes["models.Cart"]["id"]), edges)
        self.assertIn((checkout["id"], functions["models.Product.validate"]["id"]), edges)
        self.assertIn((checkout["id"], functions["models.Cart.add"]["id"]), edges)

    def test_external_service_constructors_and_methods_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "workflow.py").write_text(
                "from integrations import CatalogClient, PaymentGateway, ShippingService, format_receipt\n"
                "\n"
                "def complete_purchase():\n"
                "    catalog = CatalogClient()\n"
                "    payment = PaymentGateway()\n"
                "    shipping = ShippingService()\n"
                "    catalog.reserve_item()\n"
                "    payment.charge()\n"
                "    shipping.schedule_delivery()\n"
                "    format_receipt(payment)\n"
                "    print(str(payment))\n"
                "    payload.get('status')\n"
                "    unimported_helper()\n",
                encoding="utf-8",
            )

            result = analyse(root)

        run = result["files"][0]["functions"][0]
        self.assertEqual(
            set(run["externalCalls"]),
            {
                "CatalogClient",
                "PaymentGateway",
                "ShippingService",
                "format_receipt",
                "catalog.reserve_item",
                "payment.charge",
                "shipping.schedule_delivery",
            },
        )

    def test_src_layout_imported_call_and_nested_functions_are_analyzed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "src" / "online_store"
            services = package / "services"
            services.mkdir(parents=True)
            (package / "main.py").write_text(
                "from services.orders import create_order\n"
                "\n"
                "def place_order():\n"
                "    create_order()\n",
                encoding="utf-8",
            )
            (services / "orders.py").write_text(
                "def create_order():\n"
                "    return None\n",
                encoding="utf-8",
            )
            (services / "catalog.py").write_text(
                "def build_product_catalog():\n"
                "    def normalize_sku(sku):\n"
                "        return sku\n"
                "\n"
                "    def find_product():\n"
                "        return normalize_sku('sku-123')\n"
                "\n"
                "    if True:\n"
                "        def list_available_products():\n"
                "            return find_product()\n"
                "\n"
                "    return list_available_products\n",
                encoding="utf-8",
            )

            result = analyse(root)

        functions = {
            fn["qualifiedName"]: fn
            for file in result["files"]
            for fn in file["functions"]
        }
        edges = {
            (edge["source"], edge["target"])
            for edge in result["edges"]
        }
        place_order = functions["src.online_store.main.place_order"]
        create_order = functions["src.online_store.services.orders.create_order"]
        build_product_catalog = functions[
            "src.online_store.services.catalog.build_product_catalog"
        ]
        normalize_sku = functions[
            "src.online_store.services.catalog.build_product_catalog.normalize_sku"
        ]
        find_product = functions[
            "src.online_store.services.catalog.build_product_catalog.find_product"
        ]
        list_available_products = functions[
            "src.online_store.services.catalog.build_product_catalog.list_available_products"
        ]

        self.assertIn((place_order["id"], create_order["id"]), edges)
        self.assertIn((find_product["id"], normalize_sku["id"]), edges)
        self.assertIn((list_available_products["id"], find_product["id"]), edges)
        self.assertEqual(
            [fn["name"] for fn in build_product_catalog["nestedFunctions"]],
            ["normalize_sku", "find_product", "list_available_products"],
        )

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
