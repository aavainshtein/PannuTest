import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  concat,
  gql,
} from '@apollo/client/core'
import { InMemoryCache } from '@apollo/client/cache'

const httpLink = new HttpLink({
  fetch,
  uri: process.env.HASURA_GRAPHQL_GRAPHQL_URL,
})

const headersMiddleware = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      'x-hasura-admin-secret': process.env.HASURA_GRAPHQL_GRAPHQL_URL_SECRET,
    },
  }))

  return forward(operation)
})

const link = concat(headersMiddleware, httpLink)
const cache = new InMemoryCache()

const client = new ApolloClient({ link, cache })

export { client as apollo, gql }
