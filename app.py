from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/')
def home():
    return "Jarvis is running!"

@app.route('/command', methods=['POST'])
def command():
    data = request.json
    # Implement your command handling logic here
    return jsonify({"response": "Command received."})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
