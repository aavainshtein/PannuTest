## Configuration

```sh
cp .env.example .env
cp docker-compose.example.yaml docker-compose.yaml

docker-compose up -d
```

# Test Case Mini blog platform

Created: August 12, 2024 1:48 PM



# Task.

I was given a task to design and build backend for mini blog platform.

After reading your file I got minimal requirments:

- There should be users
- Role based access (roles admin, user)
- There should be posts with keywords.
- Posts can be deleted only by admin
- There must be some AWS lambda and fastApi integrations.
- There need to strapi aor paypal integration.

I came up with the following design to meet your requirements.

This blog platform will have paid users. Users can set their posts as public or non-public.

Public posts will be available for everyone to read, while non-public posts will only be accessible to paid users.

Additionally, there will be a microservice for validating keywords (for example, to prevent the use of rude words as keywords).

# Aproach

I will develop everything locally. For this, I will run Docker containers for Hasura, PostgreSQL, serverless functions instead of AWS Lambda, Stripe-mock instead of real Stripe, FastAPI, and RabbitMQ for message queues.

# Design.

Next you will find description of the system’s different parts.

## Useres

Given that Nhost Auth provides an Auth schema with a users table, I only need to design the rest of the tables and set up relationships and permissions.

## Payment

Since I decided to have paid users, I have designed a very simple table to store some Stripe data, including the payment status. If a user has an associated payment record with a “succeeded” status, they will be allowed to read non-public posts from other users.

<aside>
💡 Disclaimer

It is worth noting that this design makes it harder to add other payment methods, so it would be better to have a separate table or view for paid users, and separate table(s) for data from different payment providers. However, for testing purposes, I thought this would be sufficient.

</aside>

- Hasura screnshot of table “Payment”
  ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (4).png](<Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(4).png>)
- Up migration for table “Payment”
  ```sql
  CREATE TABLE "public"."payment" ("id" uuid NOT NULL DEFAULT gen_random_uuid(),
   "created_at" timestamptz NOT NULL DEFAULT now(),
   "updated_at" timestamptz NOT NULL DEFAULT now(),
   "user_id" uuid NOT NULL,
   "stripe_payment_id" text NOT NULL UNIQUE,
   "amount" integer NOT NULL,
   "currency" text NOT NULL,
   "status" text NOT NULL,
   "payment_method" text NOT NULL,
    "error_message" text, PRIMARY KEY ("id") , FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE restrict ON DELETE restrict);COMMENT ON TABLE "public"."payment" IS E'user payment';
  CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"()
  RETURNS TRIGGER AS $$
  DECLARE
    _new record;
  BEGIN
    _new := NEW;
    _new."updated_at" = NOW();
    RETURN _new;
  END;
  $$ LANGUAGE plpgsql;
  CREATE TRIGGER "set_public_payment_updated_at"
  BEFORE UPDATE ON "public"."payment"
  FOR EACH ROW
  EXECUTE PROCEDURE "public"."set_current_timestamp_updated_at"();
  COMMENT ON TRIGGER "set_public_payment_updated_at" ON "public"."payment"
  IS 'trigger to set value of column "updated_at" to current timestamp on row update';
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE  INDEX "idx_payment_created_at" on
    "public"."payment" using btree ("created_at");
  CREATE  INDEX "idx_payment_status" on
    "public"."payment" using btree ("status");
  CREATE INDEX "idx_payment_stripe_payment_id" on
    "public"."payment" using btree ("stripe_payment_id");
  CREATE  INDEX "idx_payment_user_id" on
    "public"."payment" using btree ("user_id");
  ```

### Logic

Payment can be created through the hasura GraphQL api. It is 2 step process.

1. To handle payments, I created and added an action called `createPaymentIntent`, which invokes a serverless function with parameters such as payment amount, currency, and payment type ID. The `user_id` is included in the header from Hasura. This action initializes the Stripe payment and stores the payment data (most importantly, the `stripe_payment_id`) in the payments table.
2. As payments can take a really long time and some steps, such as 3D Secure checks, to proceed, I also created a webhook for Stripe responses about the payment status. This webhook updates the payment record for the given `stripe_payment_id`.


 <details>
  <summary>Hasura screnshot of action “**createPaymentIntent**” </summary>
  
  ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (5).png](<Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(5).png>)
  
  </details>
- Code for serverless function ”**createPaymentIntent”**
  ```sql
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

  ```
- Code for webhook ”update_payment_status**”**
  ```sql
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

  ```

## Post

A post will contain information such as the title, content, a boolean flag "is_public," and an author_id. The flag will allow hiding the post from non-paid users, and the author_id will ensure that only the user who created the post can edit it.

- Hasura screnshot of table “Post”
  ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (2).png](<Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(2).png>)
  ###
- Up migration for table “Post”
  ```sql
  CREATE TABLE "public"."post" ("id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "author_id" uuid NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "is_public" boolean NOT NULL DEFAULT true,
   PRIMARY KEY ("id"), FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON UPDATE restrict ON DELETE restrict );COMMENT ON TABLE "public"."post" IS E'user\'s post';
  CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"()
  RETURNS TRIGGER AS $$
  DECLARE
    _new record;
  BEGIN
    _new := NEW;
    _new."updated_at" = NOW();
    RETURN _new;
  END;
  $$ LANGUAGE plpgsql;
  CREATE TRIGGER "set_public_post_updated_at"
  BEFORE UPDATE ON "public"."post"
  FOR EACH ROW
  EXECUTE PROCEDURE "public"."set_current_timestamp_updated_at"();
  COMMENT ON TRIGGER "set_public_post_updated_at" ON "public"."post"
  IS 'trigger to set value of column "updated_at" to current timestamp on row update';
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE  INDEX "idx_posts_author_id" on
    "public"."post" using btree ("author_id");
  CREATE  INDEX "idx_posts_is_public" on
    "public"."post" using btree ("is_public");
  CREATE  INDEX "idx_posts_created_at" on
    "public"."post" using btree ("created_at");

  ```

### Logic

Main buisnes logic can be achive through the Hasura’s permissions and relationships.

- Every user can see posts with is_public = true
- User can select all his own posts.
- Paid users can select posts with is_public = false
- Permission for role User on select from table “post”
  ```sql
  {
    "_or": [
      { "author_id": { "_eq": "X-Hasura-User-Id" } },
      { "is_public": { "_eq": true } },
      { "user": { "payments": { "status": { "_eq": "succeeded" } } } }
    ]
  }

  ```

## Keywords

As we need to set keywords for the posts, I have decided to implement a separate table for keywords and then join them with the posts in many to may table. This will allow us to easily suggest already created keywords to users and filter posts by keyword.

Also, for the purpose of this test, I have implemented a microservice to validate keyword before insertion.

- Hasura screnshot of table “keyword”
  ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify.png](Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify.png)
  [https://www.notion.so](https://www.notion.so)
- Up migration for table “keyword”
  ```sql
  CREATE TABLE "public"."keyword" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid (),
    "created_at" timestamptz NOT NULL DEFAULT now (),
    "title" text NOT NULL,
    PRIMARY KEY ("id"),
    UNIQUE ("title")
  );
  
  COMMENT ON TABLE "public"."keyword" IS 'keywords for posts';
  
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  ```
- Hasura screnshot of table “post_keyword”
  ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (3).png](<Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(3).png>)
- Up migration for table “post_keyword”
  ```sql
  CREATE TABLE "public"."post_keyword" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid (),
    "created_at" timestamptz NOT NULL DEFAULT now (),
    "post_id" uuid NOT NULL,
    "keyword_id" uuid NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("keyword_id") REFERENCES "public"."keyword" ("id") ON UPDATE restrict ON DELETE restrict,
    FOREIGN KEY ("post_id") REFERENCES "public"."post" ("id") ON UPDATE restrict ON DELETE restrict
  );
  
  COMMENT ON TABLE "public"."post_keyword" IS 'join table set posts keywords';
  
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  
  CREATE INDEX "idx_post_keyword_post_id" on "public"."post_keyword" using btree ("post_id");
  
  CREATE INDEX "idx_post_keyword_keyword_id" on "public"."post_keyword" using btree ("keyword_id");
  
  CREATE INDEX "idx_post_keyword_created_at" on "public"."post_keyword" using btree ("created_at");
  ```

### Logic

The main business logic can be achieved through Hasura’s relationships. Since we have a relationship between keywords and posts, it’s easy to filter posts by keyword.

Logic behind microservice is more complicated. It has X steps.

- First of all, users can’t directly insert keywords into the “keyword” table to prevent the possibility of bypassing validation.
- The user can invoke the **insertKeywordIfValidated** action through Hasura GraphQL API with the desired keyword as an argument.
- This action utilizes a serverless function that sends the keyword as a message to a RabbitMQ task queue.
- A FastAPI service listens to the task_queue, validates the messages, and returns a response with a true/false value through the response_queue.
- The same serverless function that sent the message listens to the response_queue, and if the response is true, it stores the keyword in the keywords table with admin rights.
- Code of fastApi service for validation
  ```sql
  from fastapi import FastAPI
  import pika
  import random
  import json
  app = FastAPI()

  def get_rabbitmq_connection():
      # Establish a connection to RabbitMQ
      connection = pika.BlockingConnection(pika.ConnectionParameters(host='rabbitmq'))
      return connection

  @app.on_event("startup")
  async def startup_event():
      # Set up the connection to RabbitMQ and start consuming messages
      app.state.rabbitmq = get_rabbitmq_connection()
      channel = app.state.rabbitmq.channel()

      print("Connected to RabbitMQ")

      # Callback function to process received messages
      def callback(ch, method, properties, body):
          message = body.decode()
          print(f"Received message from task_queue: {message}")

          # Process the message: generate a random boolean (true/false)
          is_validated = 'true'
          # is_validated = 'true' if random.choice([True, False]) else 'false'
          print(f"Processed message: {is_validated}")


           # Create a response object
          response = {
              "is_validated": is_validated,
              "message": message
          }

          print(f" response {json.dumps(response)}"),

          # Send the response object back to the response_queue
          channel.basic_publish(
              exchange='',
              routing_key='response_queue',
              body=json.dumps(response),
              properties=pika.BasicProperties(
                  correlation_id=properties.correlation_id
              )
          )


      # Subscribe to the task_queue to receive messages
      channel.basic_consume(queue='task_queue', on_message_callback=callback, auto_ack=True)
      print("Started consuming from task_queue")

      print('Waiting for messages...')
      channel.start_consuming()

  @app.on_event("shutdown")
  async def shutdown_event():
      # Close the connection to RabbitMQ when the application shuts down
      app.state.rabbitmq.close()
      print("Disconnected from RabbitMQ")

  ```
- Code of serverless function for send and precess response from Rabbit
  ```sql
  import amqp from 'amqplib/callback_api'
  import { apollo, gql } from '../_lib/apollo'
  import { Request, Response } from 'express'
  import axios from 'axios'

  export default async function handler(req: Request, res: Response) {
    const input = req?.body?.input
      ? req?.body?.input
      : 'test string' + Math.random()


    // Connect to RabbitMQ and send a message
    amqp.connect('amqp://rabbitmq', function (error0, connection) {
      if (error0) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to connect to RabbitMQ' })
        return
      }

      connection.createChannel(function (error1, channel) {
        if (error1) {
          res.status(500).json({
            success: false,
            error: 'Failed to create channel in RabbitMQ',
          })
          connection.close()
          return
        }

        const queue = 'task_queue'
        const message: string = input

        // Send the message to the task_queue
        channel.sendToQueue(queue, Buffer.from(message))

        // Subscribe to the response_queue to receive a response from FastAPI
        channel.consume(
          'response_queue',
          async function (msg) {
            console.log(
              `Received response from FastAPI: ${JSON.parse(msg.content.toString())}`,
            )
            const response = JSON.parse(msg.content.toString())
            // const response = msg.content.toString(),

            if (response.is_validated) {
              try {
                const insertKeyword = await apollo.mutate({
                  mutation: gql`
                    mutation InsertKeyword($title: String!) {
                      insert_keyword_one(object: { title: $title }) {
                        id
                      }
                    }
                  `,
                  variables: {
                    title: response.message,
                  },
                })

                console.log('Data inserted into database keyword:', insertKeyword)

                res.status(200).json({
                  success: true,
                  data: insertKeyword,
                })
              } catch (error) {
                console.error('Error inserting data into database:', error)
                res.status(500).json({
                  success: false,
                  error: 'Failed to insert data into database',
                })
              }
            } else {
              res.status(400).json({
                success: false,
                error: 'Received false from FastAPI, no data inserted.',
              })
            }

            connection.close()
          },
          { noAck: true },
        )
      })
    })
  }

  ```

# Testing

Didn’t have opprtunity to accomplish this, but wil gladly discuss it.

I will probably implement another service that will use the Hasura admin secret to perform mutations but will also send different user credentials to test permissions.

# OpenApi

- OpenApi yaml file
  ```yaml
  openapi: 3.0.1
  info:
    title: Payment Processing API
    description: APIs for creating PaymentIntents with Stripe and handling payment status updates via webhooks.
    version: 1.0.0
  paths:
    /process_payment/create_payment:
      post:
        summary: Create a PaymentIntent and save payment data
        operationId: createPaymentIntent
        requestBody:
          description: Parameters required to create a PaymentIntent and save it
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  input:
                    type: object
                    properties:
                      processPaymentCreatePaymentInput:
                        type: object
                        properties:
                          amount:
                            type: integer
                            description: Payment amount in the smallest currency unit (e.g., cents for USD)
                            example: 1000
                          currency:
                            type: string
                            description: ISO 4217 currency code
                            example: usd
                          paymentMethodId:
                            type: string
                            description: Payment method ID obtained from the client
                            example: pm_card_visa
                    required:
                      - processPaymentCreatePaymentInput
                  session_variables:
                    type: object
                    properties:
                      x-hasura-user-id:
                        type: string
                        description: The user ID from Hasura session variables
                        example: 'f8a07f3e-61b3-4e4a-8e6b-d1ef9f2f9c65'
                required:
                  - input
                  - session_variables
        responses:
          '200':
            description: Successfully created PaymentIntent and saved data
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                      description: Indicates if the operation was successful
                      example: true
                    paymentId:
                      type: string
                      description: Unique identifier of the created payment record in the database
                      format: uuid
                      example: 'f8a07f3e-61b3-4e4a-8e6b-d1ef9f2f9c65'
          '400':
            description: Error occurred during the process
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                      description: Indicates if the operation was successful
                      example: false
                    error:
                      type: string
                      description: Error message describing what went wrong
                      example: 'GraphQL mutation error'
        tags:
          - Payments
        security:
          - apiKey: []

    /process_payment/update_payment_status:
      post:
        summary: Handle Stripe Webhook Events
        description: This endpoint processes Stripe webhook events, such as `payment_intent.succeeded` and `payment_intent.payment_failed`, and updates the payment status in the database.
        operationId: updatePaymentStatus
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                    description: The ID of the Stripe event.
                  object:
                    type: string
                    description: The type of the event object.
                  type:
                    type: string
                    description: The type of the Stripe event (e.g., `payment_intent.succeeded`).
                  data:
                    type: object
                    properties:
                      object:
                        type: object
                        properties:
                          id:
                            type: string
                            description: The ID of the payment intent.
                          status:
                            type: string
                            description: The status of the payment intent.
                example:
                  id: evt_test_webhook
                  object: event
                  type: payment_intent.succeeded
                  data:
                    object:
                      id: pi_test_payment_intent
                      status: succeeded
        responses:
          '200':
            description: Webhook event successfully processed.
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    received:
                      type: boolean
                      description: Confirmation that the event was processed.
                example:
                  received: true
          '400':
            description: Webhook signature verification failed.
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                    error:
                      type: string
                example:
                  success: false
                  error: 'Webhook signature verification failed.'
          '500':
            description: Internal server error while updating payment status.
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                    error:
                      type: string
                example:
                  success: false
                  error: 'Internal Server Error'
        tags:
          - Webhooks
        security:
          - stripeSignature: []

    /keyword_validation/insertKeywordIfValidated:
      post:
        summary: Sends a message to RabbitMQ and processes the response
        operationId: sendMessageToRabbitMQ
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  input:
                    type: string
                    description: The input string to send to RabbitMQ.
                    example: 'test string'
        responses:
          '200':
            description: Successful response
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                      description: Indicates if the operation was successful.
                      example: true
                    data:
                      type: object
                      description: Contains the result of the mutation if successful.
                      properties:
                        id:
                          type: integer
                          description: The ID of the inserted keyword.
                          example: 1
          '400':
            description: Received 'false' response from FastAPI
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                      description: Indicates if the operation was successful.
                      example: false
                    error:
                      type: string
                      description: Error message indicating what went wrong.
                      example: 'Received false from FastAPI, no data inserted.'
          '500':
            description: Error occurred during the process
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    success:
                      type: boolean
                      description: Indicates if the operation was successful.
                      example: false
                    error:
                      type: string
                      description: Error message indicating what went wrong.
                      example: 'Failed to connect to RabbitMQ'
        tags:
          - RabbitMQ
  components:
    securitySchemes:
      apiKey:
        type: apiKey
        in: header
        name: x-api-key
      stripeSignature:
        type: apiKey
        name: Stripe-Signature
        in: header

    schemas:
      ProcessPaymentCreatePaymentInput:
        type: object
        properties:
          amount:
            type: integer
            description: Payment amount in the smallest currency unit (e.g., cents for USD)
            example: 1000
          currency:
            type: string
            description: ISO 4217 currency code
            example: usd
          paymentMethodId:
            type: string
            description: Payment method ID obtained from the client
            example: pm_card_visa
        required:
          - amount
          - currency
          - paymentMethodId

      CreatePaymentIntentRequest:
        type: object
        properties:
          input:
            $ref: '#/components/schemas/ProcessPaymentCreatePaymentInput'
          session_variables:
            type: object
            properties:
              x-hasura-user-id:
                type: string
                description: The user ID from Hasura session variables
                example: 'f8a07f3e-61b3-4e4a-8e6b-d1ef9f2f9c65'
        required:
          - input
          - session_variables

      CreatePaymentIntentResponse:
        type: object
        properties:
          success:
            type: boolean
            description: Indicates if the operation was successful
            example: true
          paymentId:
            type: string
            description: Unique identifier of the created payment record in the database
            format: uuid
            example: 'f8a07f3e-61b3-4e4a-8e6b-d1ef9f2f9c65'
          error:
            type: string
            description: Error message if the operation failed
            example: 'GraphQL mutation error'
  ```
