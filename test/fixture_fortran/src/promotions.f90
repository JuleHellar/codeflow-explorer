module promotions
  use customer_data, only: customer_t
  implicit none

contains

  function discount_for_customer(customer, subtotal) result(discount)
    type(customer_t), intent(in) :: customer
    real, intent(in) :: subtotal
    real :: discount

    if (customer%id > 0) then
      discount = subtotal * 0.10
    else
      discount = 0.0
    end if
  end function discount_for_customer

end module promotions
