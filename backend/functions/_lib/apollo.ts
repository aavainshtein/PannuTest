import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  concat,
  gql,
} from '@apollo/client/core'
import { InMemoryCache } from '@apollo/client/cache'

async function loggingFetch(
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const body = JSON.parse(init?.body ?? '{}')

  const start = Date.now()
  console.log(
    `${new Date().toISOString().slice(-13)} 📡 Sending ${body.operationName} request`,
  )
  const response = await fetch(input, init)
  console.log(
    `${new Date().toISOString().slice(-13)} 📡 Received ${body.operationName} response in ${Date.now() - start}ms`,
  )

  return {
    ...response,

    async text() {
      const start = Date.now()
      const result = await response.text()
      console.log(
        `${new Date().toISOString().slice(-13)} ⚙️  Read ${body.operationName} response body in ${Date.now() - start}ms (${result.length} bytes)`,
      )
      return result
    },
  }
}

// ...

// new HttpLink({ fetch: loggingFetch, uri: GRAPHQL_API_ENDPOINT })

const httpLink = new HttpLink({
  fetch: loggingFetch,
  uri: process.env.HASURA_GRAPHQL_GRAPHQL_URL,
})

const headersMiddleware = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      'x-hasura-admin-secret': process.env.HASURA_GRAPHQL_ADMIN_SECRET,
    },
  }))
  // HASURA_GRAPHQL_GRAPHQL_URL

  return forward(operation)
})

const link = concat(headersMiddleware, httpLink)
const cache = new InMemoryCache()

const client = new ApolloClient({ link, cache })

export { client as apollo, gql }
