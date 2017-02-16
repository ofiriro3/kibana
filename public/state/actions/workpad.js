import fetch from 'isomorphic-fetch';
import moment from 'moment';
import { get } from 'lodash';
import { createAction } from 'redux-actions';
import { dataframeResolveAll } from './dataframe';
import { elementResolveAll } from './element';
import { toJson } from '../../lib/resolve_fetch';

export const workpadProps = createAction('WORKPAD_PROPS');
export const workpadReplace = createAction('WORKPAD_REPLACE');

export function workpadNew() {
  return (dispatch, getState) => {
    const action = createAction('WORKPAD_NEW');
    dispatch(action());
    dispatch(workpadInit());
  };
}

export function workpadInit() {
  return (dispatch, getState) => {
    dispatch(dataframeResolveAll());
    dispatch(elementResolveAll());
  };
}

export function workpadLoad(id) {
  return (dispatch, getState) => {
    getWorkpad(id).then((resp) => {
      const action = createAction('WORKPAD_LOAD');
      dispatch(action(resp));
      dispatch(workpadInit());
    });
  };
}

export function workdpadLoadAll() {
  return (dispatch) => {
    const action = createAction('WORKPAD_LOAD_ALL', () => {
      return fetch('../api/rework/find?name=', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'kbn-xsrf': 'turdSandwich',
        }
      })
      .then(toJson('workpads'));
    });

    dispatch(action());
  };
}

export function workpadExport(id) {
  return (dispatch, getState) => {
    const startAction = createAction('WORKPAD_EXPORT_START');
    const action = createAction('WORKPAD_EXPORT', id => {
      const { persistent, transient } = getState();
      const { workpadExportData } = transient;

      // return state from loader or previously exported data if it matches
      if (get(persistent, 'workpad.id') === id) return Promise.resolve(persistent);
      if (get(workpadExportData, 'workpad.id') === id) return Promise.resolve(workpadExportData);

      // otherwise load the workpad state from the server
      return getWorkpad(id);
    });

    dispatch(startAction());
    dispatch(action(id));
  };
}

export function workpadImport(file) {
  return (dispatch) => {
    const startAction = createAction('WORKPAD_IMPORT_START');
    const action = createAction('WORKPAD_IMPORT');

    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(JSON.parse(e.target.result));
      };
      reader.readAsBinaryString(file);
    })
    .then(data => {
      const body = {
        ...data,
        '@timestamp': moment().toISOString(),
      };
      return fetch('../api/rework/import/', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'kbn-xsrf': 'turdSandwich',
        },
        body: JSON.stringify(body),
      })
      .then(toJson());
    })
    .then(() => {
      dispatch(action(file));
      dispatch(workdpadLoadAll());
    });

    dispatch(startAction());
  };
}

export function workpadDelete(id) {
  return (dispatch) => {
    const msg = 'You are about to remove this workpad, along with its dataframes and pages.\n\n' +
      'You can use the undo button to restore it.';

    if (window.confirm(msg)) {
      const startAction = createAction('WORKPAD_DELETE_START');
      const action = createAction('WORKPAD_DELETE', id => {
        return fetch('../api/rework/delete/' + id, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'kbn-xsrf': 'turdSandwich',
          }
        })
        .then(toJson('resp._id'));
      });

      dispatch(startAction(id));
      dispatch(action(id));
    }
  };
}

function getWorkpad(id) {
  return fetch('../api/rework/get/' + id, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'kbn-xsrf': 'turdSandwich',
    }
  })
  .then(toJson('resp._source'));
}
