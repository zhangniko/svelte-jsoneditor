import { compileJSONPointer, getIn, setIn } from 'immutable-json-patch'
import { first, initial, isEmpty, isEqual, last } from 'lodash-es'
import { STATE_EXPANDED, STATE_KEYS } from '../constants.js'
import { parseJSONPointerWithArrayIndices } from '../utils/jsonPointer.js'
import { isObject, isObjectOrArray } from '../utils/typeUtils.js'
import {
  getNextVisiblePath,
  getPreviousVisiblePath,
  getVisibleCaretPositions,
  getVisiblePaths
} from './documentState.js'

export const SELECTION_TYPE = {
  AFTER: 'after',
  INSIDE: 'inside',
  KEY: 'key',
  VALUE: 'value',
  MULTI: 'multi'
}

/**
 * Expand a selection start and end into an array containing all paths
 * between (and including) start and end
 *
 * @param {JSON} json
 * @param {JSON} state
 * @param {Path} anchorPath
 * @param {Path} focusPath
 * @return {Path[]} paths
 */
export function expandSelection (json, state, anchorPath, focusPath) {
  if (isEqual(anchorPath, focusPath)) {
    // just a single node
    return [anchorPath]
  } else {
    // multiple nodes
    const sharedPath = findSharedPath(anchorPath, focusPath)

    if (anchorPath.length === sharedPath.length || focusPath.length === sharedPath.length) {
      // a parent and a child, like ['arr', 1] and ['arr']
      return [sharedPath]
    }

    const anchorKey = anchorPath[sharedPath.length]
    const focusKey = focusPath[sharedPath.length]
    const value = getIn(json, sharedPath)

    if (isObject(value)) {
      const keys = getIn(state, sharedPath.concat(STATE_KEYS))
      const anchorIndex = keys.indexOf(anchorKey)
      const focusIndex = keys.indexOf(focusKey)

      if (anchorIndex !== -1 && focusIndex !== -1) {
        const startIndex = Math.min(anchorIndex, focusIndex)
        const endIndex = Math.max(anchorIndex, focusIndex)
        const paths = []

        for (let i = startIndex; i <= endIndex; i++) {
          paths.push(sharedPath.concat(keys[i]))
        }

        return paths
      }
    }

    if (Array.isArray(value)) {
      const startIndex = Math.min(anchorKey, focusKey)
      const endIndex = Math.max(anchorKey, focusKey)
      const paths = []

      for (let i = startIndex; i <= endIndex; i++) {
        paths.push(sharedPath.concat(i))
      }

      return paths
    }
  }

  throw new Error('Failed to create selection')
}

/**
 * @param {Selection} selection
 * @return {Path} Returns parent path
 */
export function getParentPath (selection) {
  if (selection.type === SELECTION_TYPE.INSIDE) {
    return selection.focusPath
  } else {
    return initial(selection.focusPath)
  }
}

/**
 * @param {Selection} selection
 * @param {Path} path
 * @return boolean
 */
// TODO: write unit test
export function isSelectionInsidePath (selection, path) {
  return (
    pathStartsWith(selection.focusPath, path) &&
    ((selection.focusPath.length > path.length) || selection.type === SELECTION_TYPE.INSIDE)
  )
}

/**
 * @param {JSON} json
 * @param {JSON} state
 * @param {Selection} selection
 * @param {boolean} [keepAnchorPath=false]
 * @returns {Selection | null}
 */
export function getSelectionUp (json, state, selection, keepAnchorPath = false) {
  const previousPath = getPreviousVisiblePath(json, state, selection.focusPath)
  const anchorPath = previousPath
  const focusPath = previousPath

  if (previousPath === null) {
    return null
  }

  if (keepAnchorPath) {
    // multi selection
    if (selection.type === SELECTION_TYPE.AFTER || selection.type === SELECTION_TYPE.INSIDE) {
      return createSelection(json, state, {
        type: SELECTION_TYPE.MULTI,
        anchorPath: selection.anchorPath,
        focusPath: selection.anchorPath
      })
    }

    return createSelection(json, state, {
      type: SELECTION_TYPE.MULTI,
      anchorPath: selection.anchorPath,
      focusPath
    })
  }

  if (selection.type === SELECTION_TYPE.KEY) {
    const parentPath = initial(previousPath)
    const parent = getIn(json, parentPath)
    if (Array.isArray(parent) || isEmpty(previousPath)) {
      // switch to value selection: array has no keys, and root object also not
      return { type: SELECTION_TYPE.VALUE, anchorPath, focusPath }
    } else {
      return { type: SELECTION_TYPE.KEY, anchorPath, focusPath }
    }
  }

  if (selection.type === SELECTION_TYPE.VALUE) {
    return { type: SELECTION_TYPE.VALUE, anchorPath, focusPath }
  }

  if (selection.type === SELECTION_TYPE.AFTER) {
    // select the node itself, not the previous node,
    // FIXME: when after an expanded object/array, should go to the last item inside the object/array
    return createSelection(json, state, {
      type: SELECTION_TYPE.MULTI,
      anchorPath: selection.focusPath,
      focusPath: selection.focusPath
    })
  }

  if (selection.type === SELECTION_TYPE.INSIDE) {
    // select the node itself, not the previous node,
    return createSelection(json, state, {
      type: SELECTION_TYPE.MULTI,
      anchorPath: selection.focusPath,
      focusPath: selection.focusPath
    })
  }

  // multi selection -> select previous node
  return createSelection(json, state, {
    type: SELECTION_TYPE.MULTI,
    anchorPath,
    focusPath
  })
}

/**
 * @param {JSON} json
 * @param {JSON} state
 * @param {Selection} selection
 * @param {boolean} [keepAnchorPath=false]
 * @returns {Selection | null}
 */
export function getSelectionDown (json, state, selection, keepAnchorPath = false) {
  // TODO: this function is too large, break it down in two separate functions: one for keepAnchorPath = true, and one for keepAnchorPath = false?
  const nextPath = getNextVisiblePath(json, state, selection.focusPath)
  const anchorPath = nextPath
  const focusPath = nextPath

  if (nextPath === null) {
    return null
  }

  if (keepAnchorPath) {
    // if the focusPath is an Array or object, we must not step into it but
    // over it, we pass state with this array/object collapsed
    const collapsedState = isObjectOrArray(getIn(json, selection.focusPath))
      ? setIn(state, selection.focusPath.concat(STATE_EXPANDED), false, true)
      : state

    const nextPathAfter = getNextVisiblePath(json, collapsedState, selection.focusPath)

    // multi selection
    if (nextPathAfter === null) {
      return null
    }

    if (selection.type === SELECTION_TYPE.AFTER) {
      return createSelection(json, state, {
        type: SELECTION_TYPE.MULTI,
        anchorPath: nextPathAfter,
        focusPath: nextPathAfter
      })
    }

    if (selection.type === SELECTION_TYPE.INSIDE) {
      return createSelection(json, state, {
        type: SELECTION_TYPE.MULTI,
        anchorPath,
        focusPath
      })
    }

    return createSelection(json, state, {
      type: SELECTION_TYPE.MULTI,
      anchorPath: selection.anchorPath,
      focusPath: nextPathAfter
    })
  }

  if (selection.type === SELECTION_TYPE.KEY) {
    const parentPath = initial(nextPath)
    const parent = getIn(json, parentPath)
    if (Array.isArray(parent)) {
      // switch to value selection: array has no keys
      return { type: SELECTION_TYPE.VALUE, anchorPath, focusPath }
    } else {
      return { type: SELECTION_TYPE.KEY, anchorPath, focusPath }
    }
  }

  if (selection.type === SELECTION_TYPE.VALUE) {
    return { type: SELECTION_TYPE.VALUE, anchorPath, focusPath }
  }

  if (selection.type === SELECTION_TYPE.INSIDE) {
    return createSelection(json, state, {
      type: SELECTION_TYPE.MULTI,
      anchorPath,
      focusPath
    })
  }

  // selection type MULTI or AFTER
  return createSelection(json, state, {
    type: SELECTION_TYPE.MULTI,
    anchorPath: nextPath,
    focusPath: nextPath
  })
}

/**
 * Get the next selection for a value inside the current object/array
 * If there is no next value, select AFTER.
 * Only applicable for SELECTION_TYPE.VALUE
 * @param {JSON} json
 * @param {JSON} state
 * @param {Selection} selection
 * @returns {Selection | null}
 */
export function getSelectionNextInside (json, state, selection) {
  // TODO: write unit tests for getSelectionNextInside
  const path = selection.focusPath
  const parentPath = initial(path)
  const childPath = [last(path)]

  const nextPathInside = getNextVisiblePath(getIn(json, parentPath), getIn(state, parentPath), childPath)

  if (nextPathInside) {
    const fullPath = parentPath.concat(nextPathInside)

    return createSelection(json, state, {
      type: SELECTION_TYPE.VALUE,
      path: parentPath.concat(nextPathInside)
    })
  } else {
    return createSelection(json, state, {
      type: SELECTION_TYPE.AFTER,
      path
    })
  }
}

/**
 * Find the caret position and its siblings for a given selection
 * @param {JSON} json
 * @param {JSON} state
 * @param {Selection} selection
 * @returns {{next: (CaretPosition|null), caret: (CaretPosition|null), previous: (CaretPosition|null)}}
 */
// TODO: unit test
export function findCaretAndSiblings (json, state, selection) {
  const visibleCaretPositions = getVisibleCaretPositions(json, state)

  const index = visibleCaretPositions.findIndex(caret => {
    return isEqual(caret.path, selection.focusPath) && caret.type === selection.type
  })

  return {
    caret: (index !== -1)
      ? visibleCaretPositions[index]
      : null,

    previous: (index !== -1 && index > 0)
      ? visibleCaretPositions[index - 1]
      : null,

    next: (index !== -1 && index < visibleCaretPositions.length - 1)
      ? visibleCaretPositions[index + 1]
      : null
  }
}

/**
 * @param {JSON} json
 * @param {JSON} state
 * @param {Selection} selection
 * @param {boolean} [keepAnchorPath=false]
 * @returns {Selection | null}
 */
export function getSelectionLeft (json, state, selection, keepAnchorPath = false) {
  const { caret, previous } = findCaretAndSiblings(json, state, selection)

  if (keepAnchorPath) {
    if (selection.type !== SELECTION_TYPE.MULTI) {
      return createSelection(json, state, {
        type: SELECTION_TYPE.MULTI,
        anchorPath: selection.anchorPath,
        focusPath: selection.focusPath
      })
    }

    return null
  }

  if (caret && previous) {
    return createSelection(json, state, {
      type: previous.type,
      path: previous.path
    })
  }

  const parentPath = initial(selection.focusPath)
  const parent = getIn(json, parentPath)

  if (selection.type === SELECTION_TYPE.VALUE && Array.isArray(parent)) {
    return createSelection(json, state, {
      type: SELECTION_TYPE.MULTI,
      anchorPath: selection.focusPath,
      focusPath: selection.focusPath
    })
  }

  if (selection.type === SELECTION_TYPE.MULTI && !Array.isArray(parent)) {
    return createSelection(json, state, {
      type: SELECTION_TYPE.KEY,
      path: selection.focusPath
    })
  }

  return null
}

/**
 * @param {JSON} json
 * @param {JSON} state
 * @param {Selection} selection
 * @param {boolean} [keepAnchorPath=false]
 * @returns {Selection | null}
 */
export function getSelectionRight (json, state, selection, keepAnchorPath = false) {
  const { caret, next } = findCaretAndSiblings(json, state, selection)

  if (keepAnchorPath) {
    if (selection.type !== SELECTION_TYPE.MULTI) {
      return createSelection(json, state, {
        type: SELECTION_TYPE.MULTI,
        anchorPath: selection.anchorPath,
        focusPath: selection.focusPath
      })
    }

    return null
  }

  if (caret && next) {
    return createSelection(json, state, {
      type: next.type,
      path: next.path
    })
  }

  if (selection.type === SELECTION_TYPE.MULTI) {
    return createSelection(json, state, {
      type: SELECTION_TYPE.VALUE,
      path: selection.focusPath
    })
  }

  return null
}

/**
 * Get a proper initial selection based on what is visible
 * @param {JSON} json
 * @param {JSON} state
 * @returns {Selection}
 */
export function getInitialSelection (json, state) {
  const visiblePaths = getVisiblePaths(json, state)

  // find the first, deepest nested entry (normally a value, not an Object/Array)
  let index = 0
  while (index < visiblePaths.length - 1 && visiblePaths[index + 1].length > visiblePaths[index].length) {
    index++
  }

  const path = visiblePaths[index]
  return (path.length === 0 || Array.isArray(getIn(json, initial(path))))
    ? { type: SELECTION_TYPE.VALUE, anchorPath: path, focusPath: path } // Array items and root object/array do not have a key, so select value in that case
    : { type: SELECTION_TYPE.KEY, anchorPath: path, focusPath: path }
}

/**
 * @param {JSON} json
 * @param {JSONPatchDocument} operations
 * @returns {MultiSelection}
 */
export function createSelectionFromOperations (json, operations) {
  if (operations.length === 1) {
    const operation = first(operations)
    if (operation.op === 'replace' || operation.op === 'move') {
      // replaced value
      const path = parseJSONPointerWithArrayIndices(json, operation.path)

      return {
        type: SELECTION_TYPE.VALUE,
        anchorPath: path,
        focusPath: path,
        edit: false
      }
    }
  }

  if (!isEmpty(operations) && operations.every(operation => operation.op === 'move')) {
    const firstOp = first(operations)
    const otherOps = operations.slice(1)

    if (firstOp.from !== firstOp.path && otherOps.every(operation => operation.from === operation.path)) {
      // a renamed key
      const path = parseJSONPointerWithArrayIndices(json, firstOp.path)

      return {
        type: SELECTION_TYPE.KEY,
        anchorPath: path,
        focusPath: path,
        edit: false
      }
    }
  }

  const paths = operations
    .filter(operation => {
      return (
        (operation.op !== 'test') &&
        (operation.op !== 'remove') &&
        (operation.op !== 'move' || operation.from !== operation.path) &&
        (typeof operation.path === 'string')
      )
    })
    .map(operation => parseJSONPointerWithArrayIndices(json, operation.path))

  if (isEmpty(paths)) {
    return null
  }

  // TODO: make this function robust against operations which do not have consecutive paths

  return {
    type: SELECTION_TYPE.MULTI,
    paths,
    anchorPath: first(paths),
    focusPath: last(paths),
    pathsMap: createPathsMap(paths)
  }
}

/**
 * @param {Path[]} paths
 * @returns {Object}
 */
// TODO: write unit tests
export function createPathsMap (paths) {
  const pathsMap = {}

  paths.forEach(path => {
    pathsMap[compileJSONPointer(path)] = true
  })

  return pathsMap
}

/**
 * Find the common path of two paths.
 * For example findCommonRoot(['arr', '1', 'name'], ['arr', '1', 'address', 'contact']) returns ['arr', '1']
 * @param {Path} path1
 * @param {Path} path2
 * @return {Path}
 */
// TODO: write unit tests for findSharedPath
export function findSharedPath (path1, path2) {
  let i = 0
  while (i < path1.length && path1[i] === path2[i]) {
    i++
  }

  return path1.slice(0, i)
}

/**
 * @param {Selection} selection
 * @return {Path}
 */
export function findRootPath (selection) {
  return selection.type === SELECTION_TYPE.MULTI && selection.paths.length > 1
    ? initial(selection.focusPath) // the parent path of the paths
    : selection.type === SELECTION_TYPE.VALUE
      ? selection.focusPath
      : []
}

/**
 * @param {Path} path
 * @param {Path} parentPath
 * @return boolean
 */
// TODO: unit test
export function pathStartsWith (path, parentPath) {
  if (path.length < parentPath.length) {
    return false
  }

  for (let i = 0; i < parentPath.length; i++) {
    if (path[i] !== parentPath[i]) {
      return false
    }
  }

  return true
}

/**
 * @param {Selection} selection
 * @return {Selection}
 */
// TODO: write unit tests
export function removeEditModeFromSelection (selection) {
  if (selection && selection.edit) {
    return {
      ...selection,
      edit: false
    }
  } else {
    return selection
  }
}

/**
 * @param {JSON} json
 * @param {JSON} state
 * @param {SelectionSchema} selectionSchema
 * @return {Selection}
 */
// TODO: write unit tests
export function createSelection (json, state, selectionSchema) {
  // TODO: remove next from SelectionSchema, pass it as a separate argument
  const { type, anchorPath, focusPath, path, edit = false, next = false, nextInside = false } = selectionSchema

  if (type === SELECTION_TYPE.KEY) {
    let selection = {
      type,
      anchorPath: path,
      focusPath: path,
      edit
    }
    if (next) {
      selection = {
        ...selection,
        type: SELECTION_TYPE.VALUE
      }
    }
    return selection
  } else if (type === SELECTION_TYPE.VALUE) {
    let selection = {
      type: SELECTION_TYPE.VALUE,
      anchorPath: path,
      focusPath: path,
      edit
    }
    if (next) {
      selection = getSelectionDown(json, state, selection) || selection
    }
    if (nextInside) {
      selection = getSelectionNextInside(json, state, selection) || selection
    }
    return selection
  } else if (type === SELECTION_TYPE.AFTER) {
    return {
      type,
      anchorPath: path,
      focusPath: path
    }
  } else if (type === SELECTION_TYPE.INSIDE) {
    return {
      type,
      anchorPath: path,
      focusPath: path
    }
  } else if (anchorPath && focusPath) {
    const paths = expandSelection(json, state, anchorPath, focusPath)

    // the original anchorPath or focusPath may be somewhere inside the
    // returned paths: when one of the two paths is inside an object and the
    // other is outside. Then the selection is enlarged to span the whole object.
    const focusPathLast = isEqual(focusPath, last(paths)) || isEqual(anchorPath, first(paths))

    return {
      type: SELECTION_TYPE.MULTI,
      anchorPath: focusPathLast ? first(paths) : last(paths),
      focusPath: focusPathLast ? last(paths) : first(paths),
      paths,
      pathsMap: createPathsMap(paths)
    }
  } else {
    throw new TypeError(`Unknown type of selection ${JSON.stringify(selectionSchema)}`)
  }
}

/**
 * Turn selected contents into plain text partial JSON, usable for copying to
 * clipboard for example.
 * @param {JSON} json
 * @param {Selection} selection
 * @param {number} [indentation=2]
 * @returns {string | null}
 */
export function selectionToPartialJson (json, selection, indentation = 2) {
  if (selection.type === SELECTION_TYPE.KEY) {
    return JSON.stringify(last(selection.focusPath))
  }

  if (selection.type === SELECTION_TYPE.VALUE) {
    const value = getIn(json, selection.focusPath)
    return JSON.stringify(value, null, indentation) // TODO: customizable indentation?
  }

  if (selection.type === SELECTION_TYPE.MULTI) {
    if (isEmpty(selection.focusPath)) {
      // root object -> does not have a parent key/index
      return JSON.stringify(json, null, indentation)
    }

    const parentPath = getParentPath(selection)
    const parent = getIn(json, parentPath)
    if (Array.isArray(parent)) {
      if (selection.paths.length === 1) {
        // do not suffix a single selected array item with a comma
        const item = getIn(json, first(selection.paths))
        return JSON.stringify(item, null, indentation)
      } else {
        return selection.paths.map(path => {
          const item = getIn(json, path)
          return `${JSON.stringify(item, null, indentation)},`
        }).join('\n')
      }
    } else {
      // parent is Object
      return selection.paths.map(path => {
        const key = last(path)
        const value = getIn(json, path)
        return `${JSON.stringify(key)}: ${JSON.stringify(value, null, indentation)},`
      }).join('\n')
    }
  }

  return null
}

/**
 * Create a selection which selects the whole document
 * @returns {Selection}
 */
// TODO: write tests
export function selectAll () {
  return {
    type: SELECTION_TYPE.VALUE,
    anchorPath: [],
    focusPath: []
  }
}
