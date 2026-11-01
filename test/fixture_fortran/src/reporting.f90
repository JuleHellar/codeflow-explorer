module reporting
  use customer_data, only: customer_t
  use billing, only: invoice_t
  implicit none

contains

  function render_receipt(customer, invoice) result(receipt)
    type(customer_t), intent(in) :: customer
    type(invoice_t), intent(in) :: invoice
    character(len=512) :: receipt

    write(receipt, '(A,I0,A,A,A,F8.2)') &
      "Customer ", customer%id, ": ", trim(invoice%product_name), &
      " total ", invoice%total
  end function render_receipt

  subroutine print_receipt(receipt)
    character(len=*), intent(in) :: receipt

    print '(A)', trim(receipt)
  end subroutine print_receipt

end module reporting
