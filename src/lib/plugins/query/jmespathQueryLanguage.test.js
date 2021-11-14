import assert from 'assert'
import { jmespathQueryLanguage, parseString } from './jmespathQueryLanguage.js'
import { cloneDeep } from 'lodash-es'

const { createQuery, executeQuery } = jmespathQueryLanguage

describe('jmespathQueryLanguage', () => {
  describe('createQuery and executeQuery', () => {
    const user1 = { _id: '1', user: { name: 'Stuart', age: 6 } }
    const user3 = { _id: '3', user: { name: 'Kevin', age: 8 } }
    const user2 = { _id: '2', user: { name: 'Bob', age: 7 } }

    const users = [user1, user3, user2]
    const originalUsers = cloneDeep([user1, user3, user2])

    it('should create a and execute an empty query', () => {
      const query = createQuery(users, {})
      const result = executeQuery(users, query)
      assert.deepStrictEqual(query, '[*]')
      assert.deepStrictEqual(result, users)
      assert.deepStrictEqual(users, originalUsers) // must not touch the original users
    })

    it('should create and execute a filter query for a nested property', () => {
      const query = createQuery(users, {
        filter: {
          field: ['user', 'name'],
          relation: '==',
          value: 'Bob'
        }
      })
      assert.deepStrictEqual(query, '[? user.name == `"Bob"`]')

      const result = executeQuery(users, query)
      assert.deepStrictEqual(result, [user2])
      assert.deepStrictEqual(users, originalUsers) // must not touch the original data
    })

    it('should create and execute a filter query for the whole array item', () => {
      const data = [2, 3, 1]
      const originalData = cloneDeep(data)

      const query = createQuery(data, {
        filter: {
          field: [],
          relation: '==',
          value: '1'
        }
      })
      assert.deepStrictEqual(query, '[? @ == `1`]')

      const result = executeQuery(data, query)
      assert.deepStrictEqual(result, [1])
      assert.deepStrictEqual(data, originalData) // must not touch the original data
    })

    it('should create and execute a sort query in ascending direction', () => {
      const query = createQuery(users, {
        sort: {
          field: ['user', 'age'],
          direction: 'asc'
        }
      })
      assert.deepStrictEqual(query, '[*] | sort_by(@, &user.age)')

      const result = executeQuery(users, query)
      assert.deepStrictEqual(result, [user1, user2, user3])

      assert.deepStrictEqual(users, originalUsers) // must not touch the original users
    })

    it('should create and execute a sort query in descending direction', () => {
      const query = createQuery(users, {
        sort: {
          field: ['user', 'age'],
          direction: 'desc'
        }
      })
      assert.deepStrictEqual(query, '[*] | reverse(sort_by(@, &user.age))')

      const result = executeQuery(users, query)
      assert.deepStrictEqual(result, [user3, user2, user1])

      assert.deepStrictEqual(users, originalUsers) // must not touch the original users
    })

    it('should create and execute a project query for a single property', () => {
      const query = createQuery(users, {
        projection: {
          fields: [['user', 'name']]
        }
      })
      assert.deepStrictEqual(query, '[*].user.name')

      const result = executeQuery(users, query)
      assert.deepStrictEqual(result, ['Stuart', 'Kevin', 'Bob'])

      assert.deepStrictEqual(users, originalUsers) // must not touch the original users
    })

    it('should create and execute a project query for a multiple properties', () => {
      const query = createQuery(users, {
        projection: {
          fields: [['user', 'name'], ['_id']]
        }
      })
      assert.deepStrictEqual(query, '[*].{name: user.name, _id: _id}')

      const result = executeQuery(users, query)
      assert.deepStrictEqual(result, [
        { name: 'Stuart', _id: '1' },
        { name: 'Kevin', _id: '3' },
        { name: 'Bob', _id: '2' }
      ])

      assert.deepStrictEqual(users, originalUsers) // must not touch the original users
    })

    it('should create and execute a query with filter, sort and project', () => {
      const query = createQuery(users, {
        filter: {
          field: ['user', 'age'],
          relation: '<=',
          value: '7'
        },
        sort: {
          field: ['user', 'name'],
          direction: 'asc'
        },
        projection: {
          fields: [['user', 'name']]
        }
      })
      assert.deepStrictEqual(query, '[? user.age <= `7`] | sort_by(@, &user.name) | [*].user.name')

      const result = executeQuery(users, query)
      assert.deepStrictEqual(result, ['Bob', 'Stuart'])

      assert.deepStrictEqual(users, originalUsers) // must not touch the original users
    })
  })

  it('should parse a string', () => {
    assert.strictEqual(parseString('foo'), 'foo')
    assert.strictEqual(parseString('234foo'), '234foo')
    assert.strictEqual(parseString('  234'), 234)
    assert.strictEqual(parseString('234  '), 234)
    assert.strictEqual(parseString('2.3'), 2.3)
    assert.strictEqual(parseString('null'), null)
    assert.strictEqual(parseString('true'), true)
    assert.strictEqual(parseString('false'), false)
    assert.strictEqual(parseString('+1'), 1)
    assert.strictEqual(parseString(' '), ' ')
    assert.strictEqual(parseString(''), '')
    assert.strictEqual(parseString('"foo"'), '"foo"')
    assert.strictEqual(parseString('"2"'), '"2"')
    assert.strictEqual(parseString("'foo'"), "'foo'")
  })
})