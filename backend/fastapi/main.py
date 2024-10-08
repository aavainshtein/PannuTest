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

        # # Send the response back to the response_queue
        # channel.basic_publish(exchange='', routing_key='response_queue', body=processed_message, properties=pika.BasicProperties(
        #     correlation_id=properties.correlation_id
        # ))
        # print(f"Sent response to response_queue: {processed_message}")

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
