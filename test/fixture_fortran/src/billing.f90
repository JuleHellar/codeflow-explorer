module billing
  use customer_data, only: customer_t
  use catalog, only: product_t
  use promotions, only: discount_for_customer
  use tax, only: calculate_tax
  implicit none

  type :: invoice_t
    integer :: customer_id
    character(len=64) :: product_name
    real :: subtotal
    real :: discount
    real :: tax
    real :: total
  end type invoice_t

contains

  function create_invoice(customer, product, quantity) result(invoice)
    type(customer_t), intent(in) :: customer
    type(product_t), intent(in) :: product
    integer, intent(in) :: quantity
    type(invoice_t) :: invoice

    invoice%customer_id = customer%id
    invoice%product_name = product%name
    invoice%subtotal = product%price * quantity
    invoice%discount = discount_for_customer(customer, invoice%subtotal)
    invoice%tax = calculate_tax(invoice%subtotal - invoice%discount, product%tax_rate)
    invoice%total = invoice%subtotal - invoice%discount + invoice%tax
  end function create_invoice

end module billing
