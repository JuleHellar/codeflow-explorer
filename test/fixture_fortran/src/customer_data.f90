module customer_data
  implicit none

  type :: customer_t
    integer :: id
    character(len=128) :: email
  end type customer_t

contains

  function load_customer(customer_id) result(customer)
    integer, intent(in) :: customer_id
    type(customer_t) :: customer

    customer%id = customer_id
    customer%email = "unknown@example.com"
  end function load_customer

  subroutine update_contact(customer, email)
    type(customer_t), intent(inout) :: customer
    character(len=*), intent(in) :: email

    customer%email = email
  end subroutine update_contact

end module customer_data
