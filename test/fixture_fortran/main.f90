program checkout_demo
  use customer_data, only: customer_t, load_customer, update_contact
  use catalog, only: product_t, find_product
  use billing, only: invoice_t, create_invoice
  use reporting, only: render_receipt, print_receipt
  implicit none

  type(customer_t) :: customer
  type(product_t) :: product
  type(invoice_t) :: invoice
  character(len=512) :: receipt

  customer = load_customer(42)
  call update_contact(customer, "ada@example.com")
  product = find_product("notebook")
  invoice = create_invoice(customer, product, 2)
  receipt = render_receipt(customer, invoice)
  call print_receipt(receipt)
end program checkout_demo
