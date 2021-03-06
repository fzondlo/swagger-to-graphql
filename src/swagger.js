// @flow
import type {SwaggerSchema, Endpoint, Responses} from './types';
import refParser from 'json-schema-ref-parser';
import type {GraphQLParameters} from './types';
import getRequestOptions from 'node-request-by-swagger';
let __schema;

export const getSchema = () => {
  if (!__schema || !Object.keys(__schema).length) {
    throw new Error('Schema was not loaded');
  }
  return __schema;
};

const getGQLTypeNameFromURL = (method: string, url: string) => {
  const fromUrl = url.replace(/[\{\}]+/g, '').replace(/[^a-zA-Z0-9_]+/g, '_');
  return `${method}${fromUrl}`;
};

const getSuccessResponse = (responses: Responses) => {
  let resp;

  if (!responses) return null;

  Object.keys(responses).some(code => {
    resp = responses[code];
    return code[0] === '2';
  });

  return resp && resp.schema;
};

export const loadSchema = (pathToSchema: string) => {
  const schemaPromise = refParser.bundle(pathToSchema)
    .then((schema) => {
      __schema = schema;
      return schema;
    });
  return schemaPromise;
};

const replaceOddChars = (str) => str.replace(/[^_a-zA-Z0-9]/g, '_');

const getServerPath = (schema) => {
  let server = schema.servers && Array.isArray(schema.servers) ? schema.servers[0] : schema.servers;
  if (!server) {
    return undefined;
  } else if (typeof server === 'string') {
    return server;
  }
  let url = server.url;
  if (server.variables) {
    Object.keys(server.variables).forEach((variable) => {
      let value = server.variables[variable];
      if (typeof (value) === 'object') {
        value = value.default || value.enum[0];
      }
      url = url.replace('{' + variable + '}', value);
    });
  }
  return url;
};

/**
 * Go through schema and grab routes
 */
export const getAllEndPoints = (schema: SwaggerSchema): {[string]: Endpoint} => {
  const allTypes = {};
  const serverPath = getServerPath(schema);
  Object.keys(schema.paths).forEach(path => {
    const route = schema.paths[path];
    Object.keys(route).forEach(method => {
      const obj = route[method];
      const isMutation = ['post', 'put', 'patch', 'delete'].indexOf(method) !== -1;
      const typeName = obj.operationId || getGQLTypeNameFromURL(method, path);
      const parameters = obj.parameters ? obj.parameters.map(param => {
        const type = param.type;
        return {name: replaceOddChars(param.name), type, jsonSchema: param};
      }) : [];
      const endpoint: Endpoint = {
        parameters,
        description: obj.description,
        response: getSuccessResponse(obj.responses),
        request: (args: GraphQLParameters, optBaseUrl: string) => {
          const baseUrl = optBaseUrl || serverPath;  // eslint-disable-line no-param-reassign
          if (!baseUrl) {
            throw new Error('Could not get the base url for endpoints. Check that either your schema has baseUrl or you provided it to constructor');
          }
          const url = `${baseUrl}${path}`;
          return getRequestOptions(obj, {
            request: args,
            url,
            method: method
          }, '');
        },
        mutation: isMutation
      };
      allTypes[typeName] = endpoint;
    });
  });
  return allTypes;
};
