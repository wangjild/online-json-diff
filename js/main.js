(function() {
  _.templateSettings = {
    interpolate: /\{\{(.+?)\}\}/g
  };
  var historyItemTemplate = _.template('\
  <li class="diff-history-item" onclick="onClickHistoryItem({{index}})">\
    <span class="history-timestamp">{{time}}</span>\
    <span class="history-string">{{historyString}}</span>\
  </li>');
  var diffHistoryStr = localStorage.getItem('diff-history');
  var diffHistory = diffHistoryStr ? JSON.parse(diffHistoryStr) : [];
  var dontTriggerSaveDiff = false;
  renderDiffHistory();

  function JsonInputView(el, initialText) {
    this.el = el;
    var codemirror = this.codemirror = CodeMirror.fromTextArea(this.el, {
      lineNumbers: true,
      mode: {name: "javascript", json: true},
      matchBrackets: true,
      theme: 'tomorrow-night'
    });
    if (initialText) {
      codemirror.setValue(initialText);
    }
    var self = this;

    codemirror.on('inputRead', function (cm, e) {
      if (e.origin === 'paste') {
        autoFormat();
      }
      triggerChange();
    });
    codemirror.on('keyup', triggerChange);
    codemirror.on('change', triggerChange);
    codemirror.on('clear', function () {
      console.log(arguments);
    });

    var oldValue = '';
    function triggerChange() {
      var text = codemirror.getValue();
        if (text !== oldValue) {
          self.trigger('change');
        }
      oldValue = text;
    }

    function autoFormat() {
      var totalLines = codemirror.lineCount();
      codemirror.autoFormatRange({line:0, ch:0}, {line:totalLines});
      codemirror.setSelection({line:0, ch:0});
    }
  }

  JsonInputView.prototype.getText = function () {
    return this.codemirror.getValue();
  };

  JsonInputView.prototype.setText = function (text) {
    return this.codemirror.setValue(text);
  };

  JsonInputView.prototype.highlightRemoval = function (diff) {
    this._highlight(diff, '#DD4444');
  };

  JsonInputView.prototype.highlightAddition = function (diff) {
    this._highlight(diff, isLightTheme() ? '#4ba2ff' : '#2E6DFF');
  };

  JsonInputView.prototype.highlightChange = function (diff) {
    this._highlight(diff, isLightTheme() ? '#E5E833' : '#9E9E00');
  };

  JsonInputView.prototype._highlight = function (diff, className) {
    var pos = getStartAndEndPosOfDiff(this.getText(), diff);
    this.codemirror.markText(pos.start, pos.end, {
      css: 'background-color: ' + className
    });
  }

  JsonInputView.prototype.clearMarkers = function () {
    this.codemirror.getAllMarks().forEach(function (marker) {
      marker.clear();
    });
  }

  function getStartAndEndPosOfDiff(textValue, diff) {
    var findPath = diff.path;
    var contexts = {
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT'
    };
    var QUOTE = '"';
    var OBJ_OPEN = '{';
    var OBJ_CLOSE = '}';
    var ARR_OPEN = '[';
    var ARR_CLOSE = ']';
    var SEPARATOR = ',';
    var ESCAPE = '\\';
    var NL = '\n';
    var OBJ_PROPERTY_RGX = /^"([^"]|\\")*"(?=\s*:)/g;
    var startPos, endPos, currChar, prevChar, currPath = [], contextStack = [], line = 0, ch = 0, inString = false;
    for (var i = 0; i < textValue.length; i++) {
      ch++;
      currChar = textValue[i];
      if (currChar === NL) {
        line++;
        ch = 0;
      } else if (currChar === OBJ_OPEN) {
        currPath.push(null);
        contextStack.push(contexts.OBJECT);
      } else if (currChar === ARR_OPEN) {
        currPath.push(0);
        contextStack.push(contexts.ARRAY);
      } else if (currChar === QUOTE && !inString && prevChar !== ESCAPE) {
        inString = true;
        var prop = getNextObjProperty(i);
        if (prop) {
          currPath.push(prop);
        }
      } else if (currChar === SEPARATOR && !inString) {
        if (context() === contexts.ARRAY) {
          var currArrayIdx = currPath[currPath.length - 1];
          currArrayIdx  = typeof(currArrayIdx ) === 'number' ? currArrayIdx  + 1 : 0;
          currPath.pop();
          currPath.push(currArrayIdx);
        } else {
          currPath.pop();
        }
      } else if (currChar === QUOTE && inString) {
        inString = false;
      } else if (currChar === OBJ_CLOSE) {
        contextStack.pop();
        currPath.pop();
        // look behind for empty object
        var matches = textValue.split('').reverse().join('').substr(textValue.length - i).match(/^\s*{/g) || [];
        var isEmptyObject = matches.length > 0;
        if (!isEmptyObject) {
          currPath.pop();
        }
      } else if (currChar === ARR_CLOSE) {
        contextStack.pop();
        currPath.pop();
      }

      var currPathStr = '/' + currPath.filter(function (item) {
        return item !== null;
      }).join('/');
      if (currPathStr === findPath && !startPos) {
        startPos = {
          line: line,
          ch: ch - 1
        };
      } else if (currPathStr.indexOf(findPath) === 0 && !(/\s/g).test(currChar)) {
        endPos = {
          line: line,
          ch: ch
        };
      }

      prevChar = currChar;
    }

    function getNextObjProperty(idx) {
      var matches = textValue.substr(idx).match(OBJ_PROPERTY_RGX) || [];
      var next = matches[0];
      if (next) {
        next = next.substr(1, next.length - 2);
      }
      return next;
    }

    function followedByComma(idx) {
      var matches = textValue.substr(idx + 1).match(/^\s*,/g) || [];
      return matches.length > 0;
    }

    function context() {
      return contextStack[contextStack.length - 1];
    }

    return {
      start: startPos,
      end: endPos
    }
  }

  function indexToPos(textValue, i) {
    var beginStr = textValue.substr(0, i);
    var lines = beginStr.split('\n');
    return {
      line: lines.length - 1,
      ch: lines[lines.length - 1].length
    };
  }

  function isLightTheme() {
    return $('body').hasClass('lighttheme');
  }

  BackboneEvents.mixin(JsonInputView.prototype);

  var uri = new URI();
  var search = uri.search(true);

  var left = undefined;
  var right = undefined;

  $.get('diff_result/' + decodeURIComponent(search.left)).done(
      function(data) {
        left = data
      }
  ).fail(
      function (data) {
        alert('获取diff结果失败，请检查参数是否正确');
      }
  );

  $.get('diff_result/' + decodeURIComponent(search.right)).done(
      function(data) {
          right = data
      }
  ).fail(
      function (data) {
          alert('获取diff结果失败，请检查参数是否正确');
      }
  );

  // var currentDiff = localStorage.getItem('current-diff') && JSON.parse(localStorage.getItem('current-diff'));

  var leftInputView = new JsonInputView(document.getElementById('json-diff-left'), left);
  var rightInputView = new JsonInputView(document.getElementById('json-diff-right'), right);
  leftInputView.on('change', onInputChange);
  rightInputView.on('change', onInputChange);
  leftInputView.codemirror.on('scroll', function () {
    var scrollInfo = leftInputView.codemirror.getScrollInfo();
    rightInputView.codemirror.scrollTo(scrollInfo.left, scrollInfo.top);
  });
  rightInputView.codemirror.on('scroll', function () {
    var scrollInfo = rightInputView.codemirror.getScrollInfo();
    leftInputView.codemirror.scrollTo(scrollInfo.left, scrollInfo.top);
  });

  if (left && right) {
    compareJson();
  }

  function onInputChange() {
    compareJson();
    saveDiff();
    debouncedSaveHistory();
  }

  function compareJson() {
    leftInputView.clearMarkers();
    rightInputView.clearMarkers();
    var leftText = leftInputView.getText(), rightText = rightInputView.getText();
    var leftJson, rightJson;
    try {
      if (leftText) {
        leftJson = JSON.parse(leftText);
      }
      if (rightText) {
        rightJson = JSON.parse(rightText);
      }
      document.getElementById('error-message').style.display = 'none';
    } catch (e) {
      document.getElementById('error-message').style.display = 'inline-block';
    }
    if (!leftJson || !rightJson) return;
    var diffs = jsonpatch.compare(leftJson, rightJson);
    window.diff = diffs;
    diffs.forEach(function (diff) {
      try {
        if (diff.op === 'remove') {
          leftInputView.highlightRemoval(diff);
        } else if (diff.op === 'add') {
          rightInputView.highlightAddition(diff);
        } else if (diff.op === 'replace') {
          rightInputView.highlightChange(diff);
          leftInputView.highlightChange(diff);
        }
      } catch(e) {
        console.warn('error while trying to highlight diff', e);
      }
    });
  }

  function saveDiff() {
    if (!localStorage.getItem('dont-save-diffs')) {
      var currentDiff = getCurrentDiff();
      localStorage.setItem('current-diff', currentDiff);
    }
  }

  var debouncedSaveHistory = _.debounce(saveHistory, 5000);

  function saveHistory() {
    if (dontTriggerSaveDiff) {
      dontTriggerSaveDiff = false;
      return;
    }
    var currentDiff = getCurrentDiff();
    if (window.diff) {
      diffHistory.push({
        time: Date.now(),
        diff: currentDiff
      });
      renderDiffHistory();
      forceMaxArraySize(diffHistory, 20);
      if (!localStorage.getItem('dont-save-diffs')) {
        localStorage.setItem('diff-history', JSON.stringify(diffHistory));
      }
    }
  }

  function forceMaxArraySize(arr, size) {
    var over = arr.length - size;
    arr.splice(0, over);
  }

  function getCurrentDiff() {
    var leftText = leftInputView.getText(), rightText = rightInputView.getText();
    return JSON.stringify({
      left: leftText, right: rightText
    });
  }

  function renderDiffHistory() {
    var inner = _.reduceRight(diffHistory, function (acc, item, i) {
      var diff = JSON.parse(item.diff);
      acc += historyItemTemplate({
        time: new Date(item.time),
        historyString: (diff.left + ' ' + diff.right).substr(0, 40),
        index: i
      });
      return acc;
    }, '');
    var html = '<ul class="diff-history-list">' + inner + '</ul>';
    $('#history-container').html(html);
  }

  window.getInputViews = function() {
    return {
      left: leftInputView,
      right: rightInputView
    };
  }
  window.compareJson = compareJson;
  window.onClickHistoryItem = function (i) {
    var item = diffHistory[i];
    var diff = JSON.parse(item.diff);
    if (diff.left !== leftInputView.getText() && diff.right !== rightInputView.getText()) {
      dontTriggerSaveDiff = true;
    }
    leftInputView.setText(diff.left);
    rightInputView.setText(diff.right);
  }
})();
