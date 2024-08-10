from fastapi import FastAPI
from strawberry.fastapi import GraphQLRouter
import strawberry

# Определяем типы и запросы для GraphQL
@strawberry.type
class Query:
    hello: str = "Hello, World!"

@strawberry.type
class Mutation:
    @strawberry.mutation
    def process_text(self, text: str) -> str:
        return text.upper()

schema = strawberry.Schema(query=Query, mutation=Mutation)

# Создание FastAPI приложения и подключение GraphQL
app = FastAPI()

graphql_app = GraphQLRouter(schema)
app.include_router(graphql_app, prefix="/graphql")

@app.get("/")
def read_root():
    return {"message": "Go to /graphql for GraphQL API"}
