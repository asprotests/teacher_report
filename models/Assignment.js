const { Schema, model } = require('mongoose');

const assignmentSchema = new Schema({
  name: String,
  gradedAt: Date
});

module.exports = model('Assignment', assignmentSchema);
