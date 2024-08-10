import axios from 'axios'

const handler = async (req, res) => {
  const { amount, currency } = req?.body?.input

  try {
    // console.log('body', req?.body?.input)
    const params = new URLSearchParams()
    params.append('amount', amount)
    params.append('currency', currency)
    params.append('source', 'tok_visa') // Используем mock-токен для тестирования

    const response = await axios.post(
      'http://stripe-mock:12111/v1/charges',
      params,
      {
        headers: {
          Authorization: `Bearer sk_test_4eC39HqLyjWDarjtT1zdp7dc`, // Ваш тестовый ключ Stripe
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    )

    return res.status(200).json({
      success: true,
      charge: response.data,
    })
  } catch (error) {
    return res.status(400).json({
      success: false,
      charge: null,
    })
  }
}

export default handler
