import { apollo, gql } from '../_lib/apollo'
import axios from 'axios'
import * as crypto from 'crypto'

const handler = async (req, res) => {
  try {
    const { amount, currency, paymentMethodId } =
      req.body.input.processPaymentCreatePaymentInput

    const userId = req.body.session_variables['x-hasura-user-id']

    const params = new URLSearchParams()
    params.append('amount', amount)
    params.append('currency', currency)
    params.append('confirm', 'false') // Используем mock-токен для тестирования
    params.append('payment_method', paymentMethodId) // Используем mock-токен для тестирования

    // 1. Create a PaymentIntent with Stripe
    const paymentIntent = await axios.post(
      'http://stripe-mock:12111/v1/payment_intents',
      params,
      {
        headers: {
          Authorization: `Bearer sk_test_4eC39HqLyjWDarjtT1zdp7dc`, // Ваш тестовый ключ Stripe
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    )

    // 2. Save payment data to the database via a Hasura GraphQL mutation

    const insertResult = await apollo.mutate({
      mutation: gql`
        mutation InsertPayment($payment: payment_insert_input!) {
          insert_payment_one(object: $payment) {
            id
          }
        }
      `,
      variables: {
        payment: {
          user_id: userId,
          stripe_payment_id: paymentIntent.data.id,
          amount,
          currency,
          status: 'requires_confirmation',
          payment_method: 'card',
        },
      },
    })

    if (insertResult.errors) {
      console.error('GraphQL Errors:', insertResult.errors)
      return res.status(400).json({
        success: false,
        error: 'GraphQL mutation error',
      })
    }

    // Simulate a webhook event for `payment_intent.succeeded`
    const webhookPayload = {
      id: 'evt_test_webhook',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntent.data.id,
          object: 'payment_intent',
          status: 'succeeded',
        },
      },
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    const payloadString = JSON.stringify(webhookPayload)

    // Create a fake signature for the webhook (simulating Stripe's signature)
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payloadString, 'utf8')
      .digest('hex')

    console.log('Generated Signature:', signature)
    // Send the simulated webhook to your webhook handler
    const webhookResponse = await axios.post(
      'http://functions:3000/process_payment/update_payment_status', // Replace with your actual webhook URL
      payloadString, // Send the payload as a raw string
      {
        headers: {
          'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=${signature}`,
          'Content-Type': 'application/json',
          'payment-intent-id': paymentIntent.data.id,
        },
      },
    )

    console.log('Webhook response:', webhookResponse.data)

    // Return a success response with the inserted payment ID
    return res.status(200).json({
      success: true,
      paymentId: insertResult.data.insert_payment_one.id,
    })
  } catch (error: any) {
    // Return an error response with the error message
    return res.status(400).json({
      success: false,
      error: error.message || 'An error occurred',
    })
  }
}
export default handler
