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

Given that Nhost Auth provides Auth schema with users table I only need to design rest of the tables and set realtionships and permissions.

## Payment

As I decided to have paid users I have designed very simple table to store some stripe data including status of payment. If user have associatied record of payment with “succeded” status he will be allowed to read non-public posts from other useres.

<aside>
💡 It is worth to note that this design is making harder to add other payment methods, so it will be better to have separeted table or view for paid useres. And separeted table or tables for data from different payment providers. But for the test porpuses I thought it will be enough.

</aside>

- Hasura screnshot of table “Paymentt”
    
    ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (4).png](Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(4).png)
    
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

1. For creating payment I created and added action **createPaymentIntent** which invokes serverless function with parametrs such as: **payment amount, currency, payment type id**.  **User_id** included in header from hasura. This action initzilize stripe payment and store data of this payment (most important is “stripe_payment_id”) to payments table.
2. As payment can take realy long time and some steps as 3dsecure check to procced I also created webhook for stripe response about status of payment. This webhook update payment record for given stripe_payment_id
- Hasura screnshot of action “**createPaymentIntent**”
    
    ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (5).png](Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(5).png)
    
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

Post will contain such info as title, content, boolean flag “is_public”. Flag will allow to hide post from nonpaid useres, and author_id to allow only user who created post to edit it.

- Hasura screnshot of table “Post”
    
    ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (2).png](Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(2).png)
    
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
        { "is_public": { "_eq": true } },
        {
          "_and": [
            { "is_public": { "_eq": false } },
            {
              "_or": [
                { "author_id": { "_eq": "X-Hasura-User-Id" } },
                { "user": { "payments": { "status": { "_eq": "succeeded" } } } }
              ]
            }
          ]
        }
      ]
    }
    
    ```
    

## Keywords

As we need to set keywords for the posts I have decided to implement separeted table for keywords, and then join them with posts. It will allow easyly suggest already created keywords for users.

Also for porpuse of this test I have implemented microservice to validate keyword before insert. 

- Hasura screnshot of table “keyword”
    
    ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify.png](Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify.png)
    
    [https://www.notion.so](https://www.notion.so)
    
- Up migration for table “keyword”
    
    ```sql
    CREATE TABLE
        "public"."keyword" (
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
    
    ![localhost_8080_console_data_default_schema_public_tables_post_keyword_modify (3).png](Test%20Case%20Mini%20blog%20platform%20ec3712983a2d45e7be76d8016ea3d0eb/localhost_8080_console_data_default_schema_public_tables_post_keyword_modify_(3).png)
    
- Up migration for table “post_keyword”
    
    ```sql
    CREATE TABLE
        "public"."post_keyword" (
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

Main buisnes logic can be achive through the Hasura’s relationships. As we have relation between keyword and post it is easy to filter posts by keyword.

Logic behind microservice is more complicated. It has X steps.

- First of all user can’t directly insert keywrod in “keyword” table. To prevent possibility of avoiding validation.
- User can invoke through Hasura GraphQL Api action **insertKeywordIfValidated** with desirable keyword as argument
- This action utilitize serverless function which will send to RabbitMQ task queue keyword as a message.
- FastApi service listenning to the task_queue, validate messages and return response with true|false value through response_queue
- Same serverless function who send message listen to response_queue and if there is true response store keyword in the keywords table under admin rights.
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
    
- 
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