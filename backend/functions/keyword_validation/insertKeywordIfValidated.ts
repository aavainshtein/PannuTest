import amqp from 'amqplib/callback_api'
import { apollo, gql } from '../_lib/apollo'
import { Request, Response } from 'express'
import axios from 'axios'

export default async function handler(req: Request, res: Response) {
  const input = req?.body?.input
    ? req?.body?.input
    : 'test string' + Math.random()

  console.log('input:', input)
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
      console.log(`Sent message to ${queue}: ${message}`)

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
