import { apollo, gql } from '../_lib/apollo'
import { Request, Response } from 'express'
import Stripe from 'stripe'

// Simulate Stripe initialization using a dummy secret key
const stripe = new Stripe('sk_test_4eC39HqLyjWDarjtT1zdp7dc', {
  apiVersion: '2024-06-20',
})

const handler = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string

  // for testing purposes
  const paymentIntentId = req.headers['payment-intent-id'] as string
  console.log(paymentIntentId, 'paymentIntentId')
  console.log('headers:', req.headers)
  let event: Stripe.Event

  try {
    // Simulate signature verification with a dummy secret

    event = {
      id: 'evt_test_webhook',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntentId,
          status: 'succeeded',
        },
      },
    }
    // event = stripe.webhooks.constructEvent(
    //   req.body, // This must be the raw body, not the parsed object
    //   sig,
    //   'whsec_test_webhook_secret', // Use a test webhook secret for local development
    // )
  } catch (err: any) {
    console.error('Webhook signature verification failed.', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Handle the event based on its type
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent

    try {
      // Update payment status in the database
      const updateResult = await apollo.mutate({
        mutation: gql`
          mutation UpdatePaymentStatus(
            $stripePaymentId: String!
            $status: String!
          ) {
            update_payment(
              where: { stripe_payment_id: { _eq: $stripePaymentId } }
              _set: { status: $status }
            ) {
              affected_rows
            }
          }
        `,
        variables: {
          stripePaymentId: paymentIntent.id,
          status: paymentIntent.status,
        },
      })

      console.log('Payment status updated:', updateResult)

      return res.status(200).json({ received: true })
    } catch (error: any) {
      console.error('Error updating payment status:', error.message)
      return res.status(500).json({ success: false, error: error.message })
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent

    try {
      // Update payment status in the database
      const updateResult = await apollo.mutate({
        mutation: gql`
          mutation UpdatePaymentStatus(
            $stripePaymentId: String!
            $status: String!
          ) {
            update_payment(
              where: { stripe_payment_id: { _eq: $stripePaymentId } }
              _set: { status: $status }
            ) {
              affected_rows
            }
          }
        `,
        variables: {
          stripePaymentId: paymentIntent.id,
          status: paymentIntent.status,
        },
      })

      console.log('Payment status updated:', updateResult)

      return res.status(200).json({ received: true })
    } catch (error: any) {
      console.error('Error updating payment status:', error.message)
      return res.status(500).json({ success: false, error: error.message })
    }
  } else {
    // Return a response to acknowledge receipt of the event
    return res.status(200).json({ received: true })
  }
}

export default handler
